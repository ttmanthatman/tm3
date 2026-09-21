// 图书阅读器核心：流式加载、进度换算、主题注入。
// 与 UI 分离，保证纯函数可单测。
import { getToken } from "../api";

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
  margin: 48,
  flow: "scrolled"
};

export type BookTapAction = "previous" | "next" | "toggle-chrome";

export function bookTapAction(flow: ReaderStyle["flow"], horizontalRatio: number): BookTapAction {
  if (flow !== "paginated") return "toggle-chrome";
  if (horizontalRatio < 0.3) return "previous";
  if (horizontalRatio > 0.7) return "next";
  return "toggle-chrome";
}

export function isBookTouchDrag(deltaX: number, deltaY: number, threshold = 8): boolean {
  return Math.hypot(deltaX, deltaY) > threshold;
}

export function buildBookCSS(style: ReaderStyle): string {
  const t = READER_THEMES[style.theme];
  return `
    @namespace epub "http://www.idpf.org/2007/ops";
    /* --theme-bg-color 会被 foliate 分页器的 #background 读取：它用图书自带背景绘制页边，
       不显式覆盖的话，切到深色主题时页边会保持 EPUB 自带的白底。 */
    html { color-scheme: ${t.scheme}; background: ${t.bg} !important; --theme-bg-color: ${t.bg}; font-size: ${style.fontPct}%; }
    body { background: ${t.bg} !important; color: ${t.fg} !important; }
    a:link { color: ${t.link} !important; }
    p, li, blockquote, dd {
      line-height: ${style.spacing};
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
  goToFraction(fraction: number): Promise<void>;
  getSectionFractions(): number[];
  renderer: {
    setAttribute(name: string, value: string): void;
    setStyles?(css: string): void;
    getContents(): { doc: Document }[];
    next(): void;
    prev(): void;
    start: number;
    end: number;
    viewSize: number;
  };
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
export async function createStreamingLoader(url: string): Promise<ZipLoader> {
  const { configure, ZipReader, HttpReader, TextWriter, BlobWriter } = await import("@zip.js/zip.js");
  configure({ useWebWorkers: false });
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const reader = new ZipReader(new HttpReader(url, { useRangeHeader: true, preventHeadRequest: true, headers: new Headers(headers) }));
  const entries = await reader.getEntries();
  const map = new Map(entries.map((entry) => [(entry as { filename: string }).filename, entry as {
    filename: string;
    getData(writer: unknown): Promise<unknown>;
  }]));
  const load = <T>(f: (entry: { getData(writer: unknown): Promise<unknown> }, ...args: unknown[]) => Promise<T>) =>
    (name: string, ...args: unknown[]) => {
      const entry = map.get(name);
      return entry ? f(entry, ...args) : Promise.resolve(null);
    };
  return {
    entries,
    loadText: load((entry) => entry.getData(new TextWriter()) as Promise<string>),
    loadBlob: load((entry, type) => entry.getData(new BlobWriter(type as string | undefined)) as Promise<Blob>),
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

// 提前加载相邻节：滚动/翻节进入下一章时内容已在缓存里（引用计数保证
// foliate 换节时的 unload 不会清掉预取），避免新章白屏闪烁。
export function preloadAdjacentSections(view: FoliateView, index: number): void {
  const sections = view.book?.sections;
  if (!sections?.length) return;
  for (const i of [index - 1, index + 1]) {
    const section = sections[i];
    if (section?.load) void section.load().catch(() => { /* 预取失败不影响当前阅读 */ });
  }
}

export type ContinuousReaderLocation = {
  index: number;
  fraction: number;
  globalFraction: number;
};

type ContinuousReaderOptions = {
  style: ReaderStyle;
  onDocumentLoad?: (doc: Document, index: number) => void;
  onRelocate?: (location: ContinuousReaderLocation) => void;
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
  private readonly loading = new Map<number, Promise<void>>();
  private readonly loaded = new Set<number>();
  private readonly resizeObservers = new Map<number, ResizeObserver>();
  private style: ReaderStyle;
  private onDocumentLoad?: (doc: Document, index: number) => void;
  private onRelocate?: (location: ContinuousReaderLocation) => void;
  private scrollFrame = 0;
  private destroyed = false;

  constructor(book: EpubBook, sectionStarts: number[], options: ContinuousReaderOptions) {
    this.book = book;
    this.sectionStarts = sectionStarts;
    this.style = options.style;
    this.onDocumentLoad = options.onDocumentLoad;
    this.onRelocate = options.onRelocate;
    this.element = document.createElement("div");
    this.element.className = "book-continuous-scroll";
    this.element.setAttribute("data-continuous-reader", "");
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
  }

  async open(fraction: number): Promise<void> {
    const target = sectionAtFraction(this.sectionStarts, fraction);
    await this.loadSection(target.index);
    await Promise.all([this.loadSection(target.index - 1, true), this.loadSection(target.index + 1)]);
    const wrapper = this.wrappers[target.index];
    if (wrapper) {
      this.element.scrollTop = wrapper.offsetTop + target.fraction * Math.max(0, wrapper.offsetHeight - 1);
    }
    this.reportLocation();
  }

  async goToFraction(fraction: number): Promise<void> {
    const target = sectionAtFraction(this.sectionStarts, fraction);
    await this.loadSection(target.index);
    const wrapper = this.wrappers[target.index];
    if (!wrapper) return;
    this.element.scrollTo({
      top: wrapper.offsetTop + target.fraction * Math.max(0, wrapper.offsetHeight - 1),
      behavior: "auto"
    });
    void this.loadSection(target.index + 1);
    this.reportLocation();
  }

  async goToHref(href: string): Promise<void> {
    const resolved = this.book.resolveHref?.(href);
    if (!resolved) return;
    await this.loadSection(resolved.index);
    const wrapper = this.wrappers[resolved.index];
    const doc = this.frames[resolved.index]?.contentDocument;
    if (!wrapper || !doc) return;
    const anchor = resolved.anchor?.(doc);
    const rect = anchor && typeof anchor !== "number" && "getBoundingClientRect" in anchor
      ? anchor.getBoundingClientRect()
      : null;
    this.element.scrollTo({ top: wrapper.offsetTop + (rect?.top ?? 0), behavior: "auto" });
    void this.loadSection(resolved.index + 1);
  }

  setStyle(style: ReaderStyle): void {
    this.style = style;
    for (let index = 0; index < this.frames.length; index += 1) {
      const doc = this.frames[index]?.contentDocument;
      if (doc) this.applyDocumentStyle(doc, index);
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.element.removeEventListener("scroll", this.handleScroll);
    if (this.scrollFrame) cancelAnimationFrame(this.scrollFrame);
    for (const observer of this.resizeObservers.values()) observer.disconnect();
    for (const index of this.loaded) this.book.sections[index]?.unload?.();
    this.resizeObservers.clear();
    this.loaded.clear();
    this.element.remove();
  }

  private readonly handleScroll = () => {
    if (this.scrollFrame) return;
    this.scrollFrame = requestAnimationFrame(() => {
      this.scrollFrame = 0;
      this.reportLocation();
      const index = this.visibleSectionIndex();
      const viewportBottom = this.element.scrollTop + this.element.clientHeight;
      const wrapper = this.wrappers[index];
      if (wrapper && wrapper.offsetTop + wrapper.offsetHeight - viewportBottom < this.element.clientHeight) {
        void this.loadSection(index + 1);
      }
      if (wrapper && this.element.scrollTop - wrapper.offsetTop < this.element.clientHeight / 2) {
        void this.loadSection(index - 1, true);
      }
    });
  };

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

  private loadSection(index: number, preserveScroll = false): Promise<void> {
    if (index < 0 || index >= this.book.sections.length || this.book.sections[index]?.linear === "no") return Promise.resolve();
    if (this.loaded.has(index)) return Promise.resolve();
    const pending = this.loading.get(index);
    if (pending) return pending;
    const promise = this.loadSectionNow(index, preserveScroll).finally(() => this.loading.delete(index));
    this.loading.set(index, promise);
    return promise;
  }

  private async loadSectionNow(index: number, preserveScroll: boolean): Promise<void> {
    const section = this.book.sections[index];
    const wrapper = this.wrappers[index];
    const previousHeight = wrapper.offsetHeight;
    const previousTop = this.element.scrollTop;
    const src = await section.load();
    if (!src || this.destroyed) return;
    const frame = document.createElement("iframe");
    frame.className = "book-continuous-frame";
    frame.setAttribute("scrolling", "no");
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.title = `电子书第 ${index + 1} 节`;
    this.frames[index] = frame;
    wrapper.replaceChildren(frame);
    await new Promise<void>((resolve, reject) => {
      frame.addEventListener("load", () => resolve(), { once: true });
      frame.addEventListener("error", () => reject(new Error(`图书第 ${index + 1} 节加载失败`)), { once: true });
      frame.src = src;
    });
    if (this.destroyed) return;
    const doc = frame.contentDocument;
    if (!doc) throw new Error(`图书第 ${index + 1} 节不可访问`);
    this.loaded.add(index);
    this.applyDocumentStyle(doc, index);
    this.onDocumentLoad?.(doc, index);
    await doc.fonts?.ready?.catch(() => undefined);
    this.measureFrame(index);
    const observer = new ResizeObserver(() => this.measureFrame(index));
    observer.observe(doc.documentElement);
    if (doc.body) observer.observe(doc.body);
    this.resizeObservers.set(index, observer);
    if (preserveScroll && wrapper.offsetTop < previousTop) {
      this.element.scrollTop = previousTop + wrapper.offsetHeight - previousHeight;
    }
  }

  private applyDocumentStyle(doc: Document, index: number): void {
    let style = doc.getElementById("team-chat-continuous-style") as HTMLStyleElement | null;
    if (!style) {
      style = doc.createElement("style");
      style.id = "team-chat-continuous-style";
      doc.head?.append(style);
    }
    const edge = Math.max(16, this.style.margin);
    style.textContent = `${buildBookCSS(this.style)}
      html { box-sizing: border-box !important; height: auto !important; min-height: 0 !important; overflow: hidden !important; padding: 24px ${edge}px !important; }
      body { width: auto !important; max-width: 720px !important; min-height: 0 !important; margin: 0 auto !important; overflow: visible !important; }
    `;
    requestAnimationFrame(() => this.measureFrame(index));
  }

  private measureFrame(index: number): void {
    const frame = this.frames[index];
    const doc = frame?.contentDocument;
    if (!frame || !doc) return;
    const height = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0, 1);
    frame.style.height = `${Math.ceil(height)}px`;
  }
}

export type { FoliateView };

export function isFoliateView(value: unknown): value is FoliateView {
  return value instanceof HTMLElement && "open" in value && "goToFraction" in value;
}
