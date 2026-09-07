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
  flow: "paginated"
};

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
  book: {
    metadata?: { title?: unknown; author?: unknown; language?: unknown };
    toc?: { label?: string; href?: string; subitems?: unknown[] }[];
    dir?: string;
    transformTarget?: EventTarget;
    // foliate 的节对象；load() 预取该节内容（内部带缓存与引用计数，重复调用便宜）
    sections?: { load?: () => Promise<unknown> }[];
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

export async function createEpubBook(loader: ZipLoader): Promise<unknown> {
  const { EPUB } = await import("foliate-js/epub.js");
  return new EPUB(loader as never).init();
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

export type { FoliateView };

export function isFoliateView(value: unknown): value is FoliateView {
  return value instanceof HTMLElement && "open" in value && "goToFraction" in value;
}
