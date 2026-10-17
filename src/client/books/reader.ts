// 图书阅读器核心：流式加载、进度换算、主题注入。
// 与 UI 分离，保证纯函数可单测。
import { preloadBookNeighbors } from "../features/books/bookAdjacentPreload";
import { applyBookTypography } from "../features/books/bookTypography";
import { forgetBookTextModel } from "../features/books/bookTextModel";
import { captureBookViewAnchor, bookViewAnchorTop, type BookViewAnchor } from "../features/books/bookViewAnchor";
import { createBookSectionQueue } from "../features/books/bookSectionQueue";
import { getToken } from "../api";
import { createReaderInsertionGate } from "../features/bible/readerInsertionGate";

export type ReaderThemeName = "light" | "sepia" | "dark";

export const READER_THEMES: Record<ReaderThemeName, { bg: string; fg: string; link: string; scheme: string; label: string }> = {
  light: { bg: "#faf7f0", fg: "#1c1c1e", link: "#0066cc", scheme: "light", label: "白" },
  sepia: { bg: "#f7f0e0", fg: "#3f3222", link: "#8b5e34", scheme: "light", label: "黄" },
  dark: { bg: "#161617", fg: "#e5e5ea", link: "#8ab4f8", scheme: "dark", label: "黑" }
};

export type ReaderStyle = {
  theme: ReaderThemeName;
  fontPct: number;
  spacing: number;
  // 页边距（px）：映射到 foliate 分页器的 margin 属性，分页与滚动版式共用
  margin: number;
  flow: "paginated" | "scrolled";
};

export const DEFAULT_READER_STYLE: ReaderStyle = {
  theme: "light",
  fontPct: 100,
  spacing: 1.6,
  margin: 16,
  flow: "scrolled"
};

export function readerStyleFromStored(stored: Partial<ReaderStyle> | null): ReaderStyle {
  const value = stored && typeof stored === "object" ? stored : {};
  const bounded = (input: unknown, fallback: number, min: number, max: number) =>
    typeof input === "number" && Number.isFinite(input) ? Math.max(min, Math.min(max, input)) : fallback;
  return {
    theme: value.theme === "sepia" || value.theme === "dark" ? value.theme : "light",
    flow: value.flow === "paginated" ? "paginated" : "scrolled",
    fontPct: bounded(value.fontPct, 100, 70, 200),
    spacing: bounded(value.spacing, 1.6, 1.2, 2.4),
    margin: value.margin === 48 ? 16 : bounded(value.margin, 16, 16, 96)
  };
}

export type BookTapAction = "previous" | "next" | "toggle-chrome";

export function bookTapAction(flow: ReaderStyle["flow"], horizontalRatio: number): BookTapAction {
  if (flow !== "paginated") return "toggle-chrome";
  if (horizontalRatio < 0.3) return "previous";
  if (horizontalRatio > 0.7) return "next";
  return "toggle-chrome";
}

export function isBookTouchDrag(deltaX: number, deltaY: number, threshold = 18): boolean {
  return Math.hypot(deltaX, deltaY) > threshold;
}

export type BookScrollDirection = "down" | "up" | null;

export function bookScrollDirection(previousScrollTop: number, currentScrollTop: number, threshold = 1): BookScrollDirection {
  if (currentScrollTop - previousScrollTop > threshold) return "down";
  if (previousScrollTop - currentScrollTop > threshold) return "up";
  return null;
}

const EPUB_NAMESPACE = "http://www.idpf.org/2007/ops";

// 标准 EPUB 脚注链接通常是 <a epub:type="noteref" href="#note-id">。
// 优先读取当前已加载章节里的目标，避免为了一个同页脚注再启动第二个阅读器。
export function bookFootnoteTargetId(anchor: Element, href: string): string | null {
  const types = new Set(anchor.getAttributeNS?.(EPUB_NAMESPACE, "type")?.split(/\s+/).filter(Boolean) ?? []);
  const roles = new Set(anchor.getAttribute?.("role")?.split(/\s+/).filter(Boolean) ?? []);
  if (!types.has("noteref") && !roles.has("doc-noteref")) return null;
  const hashIndex = href.indexOf("#");
  if (hashIndex < 0 || hashIndex === href.length - 1) return null;
  const fragment = href.slice(hashIndex + 1);
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

export function buildBookCSS(style: ReaderStyle, fixedLayout = false): string {
  const t = READER_THEMES[style.theme];
  if (fixedLayout) return `html { color-scheme: ${t.scheme}; }`;
  return `
    @namespace epub "http://www.idpf.org/2007/ops";
    /* --theme-bg-color 会被 foliate 分页器的 #background 读取：它用图书自带背景绘制页边，
       不显式覆盖的话，切到深色主题时页边会保持 EPUB 自带的白底。 */
    html { color-scheme: ${t.scheme}; background: ${t.bg} !important; --theme-bg-color: ${t.bg}; font-size: ${16 * style.fontPct / 100}px !important; }
    body { background: ${t.bg} !important; color: ${t.fg} !important; font-size: 1rem !important; line-height: ${style.spacing} !important; }
    /* Cover fixed author sizes on prose; retain heading hierarchy and inline semantics. */
    p, li, blockquote, dd, dt, div, section, article, td, th { font-size: 1rem !important; line-height: ${style.spacing} !important; }
    p :where(span, a, em, strong, b, i), li :where(span, a, em, strong, b, i) { font-size: inherit !important; line-height: inherit !important; }
    h1 { font-size: 2rem !important; } h2 { font-size: 1.5rem !important; } h3 { font-size: 1.25rem !important; }
    h4, h5, h6 { font-size: 1.1rem !important; }
    small, sup, sub { font-size: .8em !important; }
    a:link { color: ${t.link} !important; }
    p, li, blockquote, dd {
      line-height: ${style.spacing} !important;
      text-align: justify;
      hanging-punctuation: allow-end last;
      widows: 2;
    }
    [align="left"] { text-align: left; }
    [align="right"] { text-align: right; }
    [align="center"] { text-align: center; }
    pre { white-space: pre-wrap !important; }
    img { max-width: 100%; max-height: 100%; }
    aside[epub|type~="endnote"], aside[epub|type~="footnote"],
    aside[epub|type~="note"], aside[epub|type~="rearnote"] { display: none; }
  `;
}

// relocate 事件给的是节内 fraction，需要按各节字节占比换算成全书比例。
export function globalFraction(sectionStarts: number[], index: number, fractionInSection: number): number {
  const start = sectionStarts[index] ?? 0;
  const end = sectionStarts[index + 1] ?? 1;
  const value = start + fractionInSection * (end - start);
  return Math.max(0, Math.min(0.9999, value));
}

export function sectionAtFraction(sectionStarts: number[], fraction: number): { index: number; fraction: number } {
  if (sectionStarts.length < 2) return { index: 0, fraction: 0 };
  const clamped = Math.max(0, Math.min(0.9999, fraction));
  let index = sectionStarts.length - 2;
  for (let i = 0; i < sectionStarts.length - 1; i += 1) {
    if (clamped < (sectionStarts[i + 1] ?? 1)) {
      index = i;
      break;
    }
  }
  const start = sectionStarts[index] ?? 0;
  const end = sectionStarts[index + 1] ?? 1;
  return { index, fraction: Math.max(0, Math.min(1, (clamped - start) / Math.max(Number.EPSILON, end - start))) };
}

export function globalFractionFromSectionOffset(
  sectionStarts: number[],
  index: number,
  offset: number,
  extent: number
): number {
  return globalFraction(sectionStarts, index, extent > 0 ? offset / extent : 0);
}

// Stored progress identifies the viewport center; restoration must use the same anchor.
export function continuousScrollTopForFraction(sectionTop: number, sectionHeight: number, fraction: number, viewportHeight: number): number {
  return Math.max(0, sectionTop + fraction * sectionHeight - viewportHeight / 2);
}

// 落点恰好贴在章节边界时，paginator 的边界判断会把恢复位置解析到章节末尾；
// 向章节内侧轻推，避开浮点边界。
export function nudgeFromSectionBoundaries(sectionStarts: number[], fraction: number, eps = 1e-4): number {
  for (const start of sectionStarts) {
    if (Math.abs(fraction - start) < eps) {
      return start > 0.5 ? start - eps : start + eps;
    }
  }
  return fraction;
}

export function bookFileUrl(bookId: number): string {
  return `/api/books/${bookId}/file`;
}

export function bookCoverUrl(bookId: number): string {
  return `/api/books/${bookId}/cover`;
}

export type EpubSection = {
  id?: string;
  cfi?: string;
  linear?: string;
  size?: number;
  load(): Promise<string | null>;
  unload?(): void;
  resolveHref?(href: string): string;
};

export function sectionFractions(sections: EpubSection[]): number[] {
  const declaredSizes = sections.map((section) => section.linear !== "no" && (section.size ?? 0) > 0 ? section.size ?? 0 : 0);
  const hasDeclaredSizes = declaredSizes.some((size) => size > 0);
  const sizes = hasDeclaredSizes
    ? declaredSizes
    : sections.map((section) => section.linear === "no" ? 0 : 1);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  let consumed = 0;
  const starts = [0];
  for (const size of sizes) starts.push((consumed += size) / Math.max(1, total));
  return starts;
}

export type EpubBook = {
  rendition?: { layout?: string };
  resolveCFI?(cfi: string): { index: number; anchor: (doc: Document) => Range };
  metadata?: { title?: unknown; author?: unknown; language?: unknown };
  toc?: { label?: string; href?: string; subitems?: unknown[] }[];
  dir?: string;
  transformTarget?: EventTarget;
  sections: EpubSection[];
  resolveHref?(href: string): { index: number; anchor?: (doc: Document) => Node | Range | number | null } | null;
  isExternal?(href: string): boolean;
  destroy?(): void;
};

export type FootnoteLinkHandler = {
  handle(
    book: EpubBook,
    event: {
      detail: { a: Element; href: string; follow: boolean };
      preventDefault(): void;
    }
  ): Promise<void> | undefined;
};

export type BookLinkResolution =
  | { kind: "footnote"; task: Promise<void> }
  | { kind: "external" }
  | { kind: "navigate" };

// Foliate 的脚注识别同时覆盖标准 noteref 和“上标链接”启发式。
// 外链沿用 Foliate 自身的优先级；内部链接必须先让脚注处理器尝试接管，
// 否则 noteref 会被普通章节导航吞掉。
export function resolveBookLink(
  book: EpubBook,
  footnotes: FootnoteLinkHandler,
  anchor: Element,
  href: string
): BookLinkResolution {
  if (book.isExternal?.(href)) return { kind: "external" };
  const task = footnotes.handle(book, {
    detail: { a: anchor, href, follow: false },
    preventDefault() { /* 调用方负责阻止真实 click/link 事件 */ }
  });
  if (task) return { kind: "footnote", task: Promise.resolve(task) };
  return { kind: "navigate" };
}

type FoliateView = HTMLElement & {
  open(book: unknown): Promise<void>;
  close(): void;
  goToFraction(fraction: number): Promise<void>;
  getSectionFractions(): number[];
  renderer: {
    setAttribute(name: string, value: string): void;
    setStyles?(css: string): void;
    getContents(): { doc: Document }[];
    goTo?(target: { index: number; anchor: (doc: Document) => Range | null }): Promise<void>;
    next(): void;
    prev(): void;
    start: number;
    end: number;
    viewSize: number;
    page?: number;
    pages?: number;
  };
  lastLocation?: { range?: Range };
  book: EpubBook & {
    // foliate 的节对象；load() 预取该节内容（内部带缓存与引用计数，重复调用便宜）
  } | null;
};

type ZipLoader = {
  entries: unknown[];
  loadText(name: string): Promise<string | null>;
  loadBlob(name: string): Promise<Blob | null>;
  getSize(name: string): number;
};

// 通过 HTTP Range 流式读取 zip 内部条目：翻到哪节才下载哪节，弱网首屏更快。
// 需要服务端支持 Range（图书文件路由已支持），且 SW 缓存白名单包含该路径以便复读命中缓存。
export async function createStreamingLoader(url: string, signal?: AbortSignal): Promise<ZipLoader> {
  const { configure, ZipReader, HttpReader, TextWriter, BlobWriter } = await import("@zip.js/zip.js");
  configure({ useWebWorkers: false });
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  signal?.throwIfAborted();
  const reader = new ZipReader(new HttpReader(url, { useRangeHeader: true, preventHeadRequest: true, headers: new Headers(headers),
    fetch: (input, init) => fetch(input, { ...init, signal }) }));
  const entries = await reader.getEntries();
  const map = new Map(entries.map((entry) => [(entry as { filename: string }).filename, entry as {
    filename: string;
    getData(writer: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
  }]));
  const load = <T>(f: (entry: { getData(writer: unknown, options?: { signal?: AbortSignal }): Promise<unknown> }, ...args: unknown[]) => Promise<T>) =>
    (name: string, ...args: unknown[]) => {
      const entry = map.get(name);
      return entry ? f(entry, ...args) : Promise.resolve(null);
    };
  return {
    entries,
    loadText: load((entry) => entry.getData(new TextWriter(), { signal }) as Promise<string>),
    loadBlob: load((entry, type) => entry.getData(new BlobWriter(type as string | undefined), { signal }) as Promise<Blob>),
    getSize: (name) => (map.get(name) as { uncompressedSize?: number } | undefined)?.uncompressedSize ?? 0
  };
}

export async function createEpubBook(loader: ZipLoader): Promise<EpubBook> {
  const { EPUB } = await import("foliate-js/epub.js");
  return new EPUB(loader as never).init() as Promise<EpubBook>;
}

export type ReaderLayoutMetrics = {
  margin: number;
  // 正文栏宽上限（px），对应 foliate 的 max-inline-size 属性
  maxInlineSize: number;
  // 栏间距/两侧留白百分比，对应 foliate 的 gap 属性
  gapPct: number;
};

// foliate 分页器的 margin 属性只管上下边距；桌面宽屏的左右留白由
// max-inline-size（默认 720px）与 gap（默认 7%）决定，所以设置里的「边距」
// 在桌面几乎无感。这里把边距换算成三件套：
// - maxInlineSize = (舞台宽 − 边距×2) / 栏数。栏数与 foliate 规则一致：
//   分页且舞台横屏为 2 栏，其余 1 栏；foliate 内部 columnWidth = 舞台宽/栏数 − gap，
//   代入 gap≈边距后正好等于本公式，所以设置多大边距就留出多大留白。
// - gapPct：foliate 把 gap 百分比 a 折算成 px 的公式是 a/(1+a)×舞台宽，
//   反解 a = 边距/(舞台宽 − 边距)，得到 px 后恰好等于边距；
//   分页时它是栏间距，滚动时它是正文两侧 padding。
export function readerLayoutMetrics(style: ReaderStyle, stageWidth: number, stageHeight: number): ReaderLayoutMetrics {
  const margin = style.margin;
  if (!stageWidth) return { margin, maxInlineSize: 720, gapPct: 7 };
  const spread = style.flow === "paginated" && stageWidth > stageHeight ? 2 : 1;
  const textWidth = Math.max(240, stageWidth - margin * 2);
  const maxInlineSize = Math.round(textWidth / spread);
  const gapPct = Math.round((margin / Math.max(1, stageWidth - margin)) * 1000) / 10;
  return { margin, maxInlineSize, gapPct };
}

// Foliate reports the end of the visible page. Its numeric navigation anchor
// instead spans the first through last page, excluding two blank edge pages.
export function paginatedBookFraction(starts: number[], index: number, page: number, pages: number): number {
  const local = pages > 3 ? Math.max(0, Math.min(1, (page - 1) / (pages - 3))) : 0;
  const start = starts[index] ?? 0, end = starts[index + 1] ?? 1;
  return start + (end - start) * local;
}

// 相邻节预取各持有一个可释放引用；换章和关闭时回收。
export function preloadAdjacentSections(view: FoliateView, index: number): void { preloadBookNeighbors(view, index); }

export type ContinuousReaderLocation = {
  index: number;
  fraction: number;
  globalFraction: number;
};

type ContinuousReaderOptions = {
  style: ReaderStyle;
  onDocumentLoad?: (doc: Document, index: number) => void;
  onDocumentUnload?: (doc: Document, index: number) => void;
  onBackgroundError?: (error: unknown) => void;
  onRelocate?: (location: ContinuousReaderLocation) => void;
  onScrollDirection?: (direction: Exclude<BookScrollDirection, null>) => void;
};

// foliate 的 scrolled flow 仍只挂载一个 spine section，越过章末时会整章替换。
// 这里用一组同源 iframe 顺序承载各 section，并按需加载相邻章，使章末和下一章
// 开头真实存在于同一个原生滚动容器中。EPUB 资源 URL 仍由 foliate 的 loader 改写。
export class ContinuousBookReader {
  readonly element: HTMLDivElement;
  private readonly book: EpubBook;
  private readonly sectionStarts: number[];
  private readonly wrappers: HTMLDivElement[];
  private readonly frames: Array<HTMLIFrameElement | null>;
  private readonly loaded = new Set<number>();
  private readonly acquiredSections = new Set<number>();
  private readonly resizeObservers = new Map<number, ResizeObserver>();
  private readonly queue = createBookSectionQueue(2);
  private readonly documentControllers = new Map<number, AbortController>();
  private readonly resizeObserver: ResizeObserver;
  private readonly placeholders = new Map<number, { height: number; width: number; fontPct: number; spacing: number }>();
  private navigation = 0;
  private targetIndex = 0;
  private pendingNavigation: { request: number } | null = null;
  private layoutAnchor: BookViewAnchor | null = null;
  private lastAnchor: BookViewAnchor | null = null;
  private programmaticTop: number | null = null;
  private styleGeneration = 0;
  private styleFrame = 0;
  private readonly insertionGate = createReaderInsertionGate();
  private readonly interactionController = new AbortController();
  private readonly pendingResizes = new Set<number>();
  private style: ReaderStyle;
  private onDocumentUnload?: (doc: Document, index: number) => void;
  private onBackgroundError?: (error: unknown) => void;
  private onDocumentLoad?: (doc: Document, index: number) => void;
  private onRelocate?: (location: ContinuousReaderLocation) => void;
  private onScrollDirection?: (direction: Exclude<BookScrollDirection, null>) => void;
  private scrollFrame = 0;
  private lastScrollTop = 0;
  private destroyed = false;

  constructor(book: EpubBook, sectionStarts: number[], options: ContinuousReaderOptions) {
    this.book = book;
    this.sectionStarts = sectionStarts;
    this.style = options.style;
    this.onDocumentLoad = options.onDocumentLoad;
    this.onDocumentUnload = options.onDocumentUnload;
    this.onBackgroundError = options.onBackgroundError;
    this.onRelocate = options.onRelocate;
    this.onScrollDirection = options.onScrollDirection;
    this.element = document.createElement("div");
    this.element.className = "book-continuous-scroll";
    this.element.setAttribute("data-continuous-reader", "");
    // This reader owns its anchor correction; native anchoring would apply it twice.
    this.element.style.overflowAnchor = "none";
    this.element.style.scrollBehavior = "auto";
    this.wrappers = book.sections.map((section, index) => {
      const wrapper = document.createElement("div");
      wrapper.className = "book-continuous-section";
      wrapper.dataset.sectionIndex = String(index);
      if (section.linear === "no") wrapper.hidden = true;
      this.element.append(wrapper);
      return wrapper;
    });
    this.frames = book.sections.map(() => null);
    this.element.addEventListener("scroll", this.handleScroll, { passive: true });
    this.bindTouchEvents(this.element);
    this.resizeObserver = new ResizeObserver(() => this.reflowViewport());
    this.resizeObserver.observe(this.element);
  }

  async open(fraction: number): Promise<void> { await this.goToFraction(fraction); }

  async goToFraction(fraction: number): Promise<void> {
    const request = ++this.navigation;
    this.layoutAnchor = null;
    const target = sectionAtFraction(this.sectionStarts, fraction);
    this.targetIndex = target.index;
    this.queue.retain(index => Math.abs(index - target.index) <= 2);
    this.pendingNavigation = { request };
    try { await this.loadSection(target.index, false, true); }
    finally { if (this.pendingNavigation?.request === request) this.pendingNavigation = null; }
    if (this.destroyed || request !== this.navigation) return;
    const wrapper = this.wrappers[target.index];
    if (!wrapper || !this.loaded.has(target.index)) return;
    this.scrollTo(continuousScrollTopForFraction(wrapper.offsetTop, wrapper.offsetHeight, target.fraction, this.element.clientHeight));
    this.prefetch(target.index - 1, true);
    this.prefetch(target.index + 1);
    this.trimSections();
    this.lastAnchor = this.captureAnchor();
    this.reportLocation();
    this.prefetchViewport();
  }

  goToRange(doc: Document, range: Range): void {
    ++this.navigation;
    this.pendingNavigation = null;
    this.layoutAnchor = null;
    const index = this.frames.findIndex((frame) => frame?.contentDocument === doc);
    const wrapper = this.wrappers[index];
    if (!wrapper || !this.loaded.has(index)) return;
    this.targetIndex = index;
    this.scrollTo(Math.max(0, wrapper.offsetTop + range.getBoundingClientRect().top - this.element.clientHeight / 3));
    this.lastAnchor = this.captureAnchor();
    this.reportLocation();
  }

  async goToHref(href: string): Promise<void> {
    const request = ++this.navigation;
    this.layoutAnchor = null;
    const resolved = this.book.resolveHref?.(href);
    if (!resolved) return;
    this.targetIndex = resolved.index;
    this.pendingNavigation = { request };
    try { await this.loadSection(resolved.index, false, true); }
    finally { if (this.pendingNavigation?.request === request) this.pendingNavigation = null; }
    if (this.destroyed || request !== this.navigation) return;
    const wrapper = this.wrappers[resolved.index];
    const doc = this.frames[resolved.index]?.contentDocument;
    if (!wrapper || !doc) return;
    const anchor = resolved.anchor?.(doc);
    const rect = anchor && typeof anchor !== "number" && "getBoundingClientRect" in anchor
      ? anchor.getBoundingClientRect()
      : null;
    this.scrollTo(wrapper.offsetTop + (rect?.top ?? 0));
    this.prefetch(resolved.index + 1);
    this.lastAnchor = this.captureAnchor();
    this.reportLocation();
    this.prefetchViewport();
  }

  setStyle(style: ReaderStyle): void {
    if (this.destroyed) return;
    this.layoutAnchor ??= this.captureAnchor();
    this.style = style;
    const generation = ++this.styleGeneration;
    if (this.styleFrame) cancelAnimationFrame(this.styleFrame);
    this.styleFrame = requestAnimationFrame(() => {
      this.styleFrame = 0;
      if (this.destroyed || generation !== this.styleGeneration) return;
      for (let index = 0; index < this.frames.length; index++) {
        const doc = this.frames[index]?.contentDocument;
        if (doc) this.applyDocumentStyle(doc, index);
      }
      for (const [index, measured] of this.placeholders) if (!this.loaded.has(index)) {
        const fontRatio = this.style.fontPct / measured.fontPct;
        const widthRatio = measured.width / this.textWidth();
        this.wrappers[index].style.height = `${Math.max(1, Math.round(measured.height * fontRatio ** 2 * this.style.spacing / measured.spacing * widthRatio))}px`;
        this.wrappers[index].dataset.estimatedHeight = "true";
      }
      for (const index of this.loaded) this.measureFrame(index, true);
      this.restoreAnchor(this.layoutAnchor);
      this.lastAnchor = this.layoutAnchor ?? this.captureAnchor();
      this.layoutAnchor = null;
      this.prefetchViewport();
    });
  }

  destroy(): void {
    this.destroyed = true;
    ++this.navigation;
    this.queue.destroy();
    this.resizeObserver.disconnect();
    if (this.styleFrame) cancelAnimationFrame(this.styleFrame);
    for (const [index, controller] of this.documentControllers) {
      controller.abort();
      const doc = this.frames[index]?.contentDocument;
      if (doc) { this.onDocumentUnload?.(doc, index); forgetBookTextModel(doc); }
    }
    this.documentControllers.clear();
    this.element.removeEventListener("scroll", this.handleScroll);
    this.interactionController.abort();
    this.insertionGate.cancel();
    if (this.scrollFrame) cancelAnimationFrame(this.scrollFrame);
    for (const observer of this.resizeObservers.values()) observer.disconnect();
    for (const index of this.acquiredSections) this.book.sections[index]?.unload?.();
    this.resizeObservers.clear();
    this.acquiredSections.clear();
    this.pendingResizes.clear();
    this.loaded.clear();
    this.element.remove();
  }

  private readonly handleScroll = () => {
    const compensation = this.programmaticTop !== null && Math.abs(this.element.scrollTop - this.programmaticTop) < 1;
    if (!compensation) { this.insertionGate.motion(); this.layoutAnchor = null; }
    if (this.scrollFrame) return;
    this.scrollFrame = requestAnimationFrame(() => {
      this.scrollFrame = 0;
      const currentScrollTop = this.element.scrollTop;
      const programmatic = this.programmaticTop !== null && Math.abs(currentScrollTop - this.programmaticTop) < 1;
      this.programmaticTop = null;
      const direction = programmatic ? null : bookScrollDirection(this.lastScrollTop, currentScrollTop);
      this.lastScrollTop = currentScrollTop;
      if (direction) this.onScrollDirection?.(direction);
      if (this.pendingNavigation?.request === this.navigation) return;
      if (!programmatic) this.reportLocation();
      // A delayed scroll event can arrive after image/font layout has already
      // changed. Keep the source anchor established by the navigation/layout.
      if (!programmatic && !this.layoutAnchor) this.lastAnchor = this.captureAnchor();
      const index = this.visibleSectionIndex();
      this.targetIndex = index;
      this.trimSections();
      this.prefetchViewport();
    });
  };

  private prefetchViewport(): void {
    if (this.destroyed || this.pendingNavigation?.request === this.navigation) return;
    const top = this.element.scrollTop, bottom = top + this.element.clientHeight;
    // The last short page can be visible even while the midpoint is in the cover.
    // Continue after commits as well: a viewport full of short pages may not scroll yet.
    for (const index of this.loaded) {
      const wrapper = this.wrappers[index], end = wrapper.offsetTop + wrapper.offsetHeight;
      if (end < top || wrapper.offsetTop > bottom) continue;
      if (end - bottom < this.element.clientHeight) {
        let next = index + 1;
        while (this.book.sections[next]?.linear === "no") next++;
        this.prefetch(next);
      }
      if (top - wrapper.offsetTop < this.element.clientHeight / 2) {
        let previous = index - 1;
        while (this.book.sections[previous]?.linear === "no") previous--;
        this.prefetch(previous, true);
      }
    }
  }

  private isRelevantSection(index: number): boolean {
    if (Math.abs(index - this.targetIndex) <= 3) return true;
    let previous = index - 1;
    while (this.book.sections[previous]?.linear === "no") previous--;
    if (!this.loaded.has(previous)) return false;
    const wrapper = this.wrappers[previous], end = wrapper.offsetTop + wrapper.offsetHeight;
    // A run of tiny chapters must fill the visible page before it can scroll.
    return end >= this.element.scrollTop && end <= this.element.scrollTop + this.element.clientHeight;
  }

  private visibleSectionIndex(): number {
    const center = this.element.scrollTop + this.element.clientHeight / 2;
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < this.wrappers.length; index += 1) {
      const wrapper = this.wrappers[index];
      if (wrapper.hidden || !this.loaded.has(index)) continue;
      const start = wrapper.offsetTop;
      const end = start + wrapper.offsetHeight;
      if (center >= start && center <= end) return index;
      const distance = Math.min(Math.abs(center - start), Math.abs(center - end));
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    return bestIndex;
  }

  private reportLocation(): void {
    const index = this.visibleSectionIndex();
    const wrapper = this.wrappers[index];
    if (!wrapper || !this.loaded.has(index)) return;
    const center = this.element.scrollTop + this.element.clientHeight / 2;
    const fraction = Math.max(0, Math.min(1, (center - wrapper.offsetTop) / Math.max(1, wrapper.offsetHeight)));
    this.onRelocate?.({
      index,
      fraction,
      globalFraction: globalFractionFromSectionOffset(this.sectionStarts, index, fraction, 1)
    });
  }

  private prefetch(index: number, preserveScroll = false): void {
    void this.loadSection(index, preserveScroll).catch(error => this.onBackgroundError?.(error));
  }

  private loadSection(index: number, preserveScroll = false, foreground = false): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    if (index < 0 || index >= this.book.sections.length || this.book.sections[index]?.linear === "no") return Promise.resolve();
    if (this.loaded.has(index)) return Promise.resolve();
    return this.queue.run(index, async () => {
      try { await this.loadSectionNow(index, preserveScroll); }
      catch (error) { this.releaseSection(index); throw error; }
    }, foreground);
  }

  private async loadSectionNow(index: number, preserveScroll: boolean): Promise<void> {
    const section = this.book.sections[index];
    const wrapper = this.wrappers[index];
    const src = await section.load();
    if (!src) throw new Error(`图书第 ${index + 1} 节没有正文`);
    if (this.destroyed) { section.unload?.(); return; }
    this.acquiredSections.add(index);
    if (!this.isRelevantSection(index)) { this.releaseSection(index); return; }
    const frame = document.createElement("iframe");
    frame.className = "book-continuous-frame";
    frame.setAttribute("scrolling", "no");
    // WebKit blocks even parent-installed event listeners in a sandboxed frame unless
    // allow-scripts is present (WebKit 218086). The app CSP still limits scripts to
    // 'self', matching foliate-js' own paginator/fixed-layout iframe policy.
    frame.setAttribute("sandbox", "allow-same-origin allow-scripts");
    frame.title = `电子书第 ${index + 1} 节`;
    // A loading iframe must not add its default 150px height, then its full
    // chapter height, above a live native gesture. Measure it outside flow first.
    frame.style.cssText = `position:fixed;visibility:hidden;pointer-events:none;width:${this.element.clientWidth}px;height:1px`;
    this.frames[index] = frame;
    wrapper.replaceChildren(frame);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error(`图书第 ${index + 1} 节加载超时，请重试`)); }, 15000);
      const abort = () => { cleanup(); resolve(); };
      const cleanup = () => { clearTimeout(timer); this.interactionController.signal.removeEventListener("abort", abort); };
      this.interactionController.signal.addEventListener("abort", abort, { once: true });
      frame.addEventListener("load", () => { cleanup(); resolve(); }, { once: true });
      frame.addEventListener("error", () => { cleanup(); reject(new Error(`图书第 ${index + 1} 节加载失败`)); }, { once: true });
      frame.src = src;
    });
    if (this.destroyed) return;
    const doc = frame.contentDocument;
    if (!doc) throw new Error(`图书第 ${index + 1} 节不可访问`);
    this.applyDocumentStyle(doc, index);
    // Do not block readable text on remote fonts; later reflow uses the same text anchor.
    void doc.fonts?.ready.then(() => { if (!this.destroyed) this.measureFrame(index); });
    if (this.destroyed) return;
    this.measureFrame(index);
    if (preserveScroll || wrapper.offsetTop < this.element.scrollTop) {
      const ready = await this.insertionGate.wait();
      if (!ready || this.destroyed) return;
    }
    if (!this.isRelevantSection(index)) { this.releaseSection(index); return; }
    // Images can finish loading while the insertion is deferred.
    frame.style.width = `${this.element.clientWidth}px`;
    this.measureFrame(index);
    // Capture at commit time, after asynchronous loading and native movement.
    const anchor = this.wrappers[this.visibleSectionIndex()];
    const anchorTop = anchor?.getBoundingClientRect().top;
    frame.style.removeProperty("position");
    frame.style.removeProperty("visibility");
    frame.style.removeProperty("pointer-events");
    frame.style.removeProperty("width");
    wrapper.style.removeProperty("height");
    delete wrapper.dataset.estimatedHeight;
    this.placeholders.delete(index);
    this.loaded.add(index);
    if (anchor && anchor !== wrapper && anchorTop !== undefined) {
      const delta = anchor.getBoundingClientRect().top - anchorTop;
      this.scrollTo(this.element.scrollTop + delta);
    }
    const controller = new AbortController();
    this.documentControllers.set(index, controller);
    this.bindTouchEvents(doc, controller.signal);
    this.onDocumentLoad?.(doc, index);
    this.lastAnchor = this.captureAnchor();
    const observer = new ResizeObserver(() => {
      const anchor = this.lastAnchor;
      this.measureFrame(index);
      if (anchor?.doc === doc) this.restoreAnchor(anchor);
      this.prefetchViewport();
    });
    observer.observe(doc.documentElement);
    if (doc.body) observer.observe(doc.body);
    this.resizeObservers.set(index, observer);
    this.prefetchViewport();
  }

  private bindTouchEvents(target: HTMLElement | Document, signal = this.interactionController.signal): void {
    const options = { passive: true, signal };
    target.addEventListener("pointerdown", () => { ++this.navigation; this.layoutAnchor = null; }, options);
    target.addEventListener("wheel", () => { ++this.navigation; this.layoutAnchor = null; this.lastAnchor = null; this.programmaticTop = null; }, options);
    target.addEventListener("touchstart", () => { ++this.navigation; this.layoutAnchor = null; this.lastAnchor = null; this.insertionGate.touchStart(); }, options);
    target.addEventListener("touchend", () => this.insertionGate.touchEnd(), options);
    target.addEventListener("touchcancel", () => this.insertionGate.touchEnd(), options);
  }

  private scrollTo(top: number): void {
    this.element.scrollTo({ top, behavior: "instant" });
    this.lastScrollTop = this.element.scrollTop;
    this.programmaticTop = this.element.scrollTop;
  }

  captureAnchor(): BookViewAnchor | null {
    const bounds = this.element.getBoundingClientRect();
    const top = bounds.top + this.element.clientHeight / 3;
    for (const index of this.loaded) {
      const doc = this.frames[index]?.contentDocument;
      const frame = this.frames[index]?.getBoundingClientRect();
      if (doc && frame && frame.top <= top && frame.bottom > top) return captureBookViewAnchor(doc, top, bounds.bottom);
    }
    return null;
  }

  private restoreAnchor(anchor: BookViewAnchor | null): void {
    if (!anchor || this.destroyed) return;
    const top = bookViewAnchorTop(anchor);
    if (top !== null && Math.abs(top - anchor.top) > .5) this.scrollTo(this.element.scrollTop + top - anchor.top);
  }

  private reflowViewport(): void {
    if (this.destroyed) return;
    const anchor = this.lastAnchor ?? this.captureAnchor();
    this.layoutAnchor = anchor ? { ...anchor, top: this.element.getBoundingClientRect().top + this.element.clientHeight / 3 } : null;
    this.lastAnchor = this.layoutAnchor;
    this.setStyle(this.style);
  }

  private releaseSection(index: number): void {
    const frame = this.frames[index];
    const doc = frame?.contentDocument;
    if (doc) { this.onDocumentUnload?.(doc, index); forgetBookTextModel(doc); }
    this.resizeObservers.get(index)?.disconnect(); this.resizeObservers.delete(index);
    this.documentControllers.get(index)?.abort(); this.documentControllers.delete(index);
    if (this.loaded.has(index)) {
      const height = this.wrappers[index].offsetHeight;
      this.placeholders.set(index, { height, width: this.textWidth(), fontPct: this.style.fontPct, spacing: this.style.spacing });
      this.wrappers[index].style.height = `${height}px`;
    }
    frame?.remove(); this.frames[index] = null; this.loaded.delete(index);
    if (this.acquiredSections.delete(index)) this.book.sections[index]?.unload?.();
  }

  private textWidth(): number {
    return Math.max(1, Math.min(this.element.clientWidth - 2 * this.style.margin, Math.max(320, 720 - 2 * (this.style.margin - 16))));
  }

  private trimSections(): void {
    // Seven normal chapters, or three for large chapters; selected/shared text stays alive.
    const indices = [...this.loaded].sort((a, b) => Math.abs(a - this.targetIndex) - Math.abs(b - this.targetIndex));
    let bytes = 0;
    for (let rank = 0; rank < indices.length; rank++) {
      const index = indices[rank], doc = this.frames[index]?.contentDocument;
      bytes += this.book.sections[index]?.size ?? 0;
      const protectedText = !!doc?.getSelection()?.toString() || !!doc?.querySelector("[data-book-quote-highlight]");
      const wrapper = this.wrappers[index];
      const visible = wrapper.offsetTop + wrapper.offsetHeight > this.element.scrollTop && wrapper.offsetTop < this.element.scrollTop + this.element.clientHeight;
      if (!visible && !protectedText && Math.abs(index - this.targetIndex) > 1 && (rank >= 7 || Math.abs(index - this.targetIndex) > 3 || bytes > 2_000_000)) this.releaseSection(index);
    }
  }

  private applyDocumentStyle(doc: Document, index: number): void {
    let style = doc.getElementById("team-chat-continuous-style") as HTMLStyleElement | null;
    if (!style) {
      style = doc.createElement("style");
      style.id = "team-chat-continuous-style";
      doc.head?.append(style);
    }
    applyBookTypography(doc, this.style);
    const edge = Math.max(16, this.style.margin);
    // 窄屏由 html padding 决定两侧留白；宽屏正文原本固定在 720px，
    // padding 变化只挤压空白区，视觉上完全不动。同步收窄居中的正文栏，
    // 让每增加 16px 边距，桌面正文两侧也各增加 16px 留白。
    const maxTextWidth = Math.max(320, 720 - 2 * (edge - DEFAULT_READER_STYLE.margin));
    style.textContent = `${buildBookCSS(this.style)}
      html { box-sizing: border-box !important; height: auto !important; min-height: 0 !important; overflow: hidden !important; padding: 24px ${edge}px !important; }
      body { width: auto !important; max-width: ${maxTextWidth}px !important; min-height: 0 !important; margin: 0 auto !important; overflow: visible !important; }
    `;
    this.measureFrame(index);
  }

  private measureFrame(index: number, afterQuiet = false): void {
    const frame = this.frames[index];
    const doc = frame?.contentDocument;
    if (!frame || !doc || this.destroyed) return;
    // scrollHeight cannot shrink below the iframe viewport, creating a resize
    // feedback loop. The root's natural box measures the chapter independently.
    const root = doc.documentElement;
    const body = doc.body;
    const paddingBottom = Number.parseFloat(doc.defaultView?.getComputedStyle(root).paddingBottom ?? "0") || 0;
    const contents = doc.createRange();
    if (body) contents.selectNodeContents(body);
    // Include positioned illustrations without using a viewport-sized scrollHeight.
    const overflowBottom = body ? contents.getBoundingClientRect().bottom + paddingBottom : 0;
    const height = Math.ceil(Math.max(root.getBoundingClientRect().height, overflowBottom, 1));
    if (frame.style.height === `${height}px`) return;
    const wrapper = this.wrappers[index];
    const aboveViewport = this.loaded.has(index) && wrapper.offsetTop + wrapper.offsetHeight <= this.element.scrollTop;
    if (aboveViewport && !afterQuiet) {
      if (!this.pendingResizes.has(index)) {
        this.pendingResizes.add(index);
        void this.insertionGate.wait().then((ready) => {
          this.pendingResizes.delete(index);
          if (ready) this.measureFrame(index, true);
        });
      }
      return;
    }
    const anchor = aboveViewport ? this.wrappers[this.visibleSectionIndex()] : null;
    const anchorTop = anchor?.getBoundingClientRect().top;
    frame.style.height = `${height}px`;
    if (anchor && anchorTop !== undefined) {
      // Shrinking can clamp scrollTop before correction; use that current value.
      const delta = anchor.getBoundingClientRect().top - anchorTop;
      this.scrollTo(this.element.scrollTop + delta);
    }
  }
}

export type { FoliateView };

export function isFoliateView(value: unknown): value is FoliateView {
  return value instanceof HTMLElement && "open" in value && "goToFraction" in value;
}
