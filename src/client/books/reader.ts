// 图书阅读器核心：流式加载、进度换算、主题注入。
// 与 UI 分离，保证纯函数可单测。
import { getToken } from "../api";

export type ReaderThemeName = "light" | "sepia" | "dark";

export const READER_THEMES: Record<ReaderThemeName, { bg: string; fg: string; link: string; scheme: string; label: string }> = {
  light: { bg: "#ffffff", fg: "#1c1c1e", link: "#0066cc", scheme: "light", label: "白" },
  sepia: { bg: "#f7f0e0", fg: "#3f3222", link: "#8b5e34", scheme: "light", label: "黄" },
  dark: { bg: "#161617", fg: "#e5e5ea", link: "#8ab4f8", scheme: "dark", label: "黑" }
};

export type ReaderStyle = {
  theme: ReaderThemeName;
  fontPct: number;
  spacing: number;
  flow: "paginated" | "scrolled";
};

export const DEFAULT_READER_STYLE: ReaderStyle = {
  theme: "light",
  fontPct: 100,
  spacing: 1.6,
  flow: "paginated"
};

export function buildBookCSS(style: ReaderStyle): string {
  const t = READER_THEMES[style.theme];
  return `
    @namespace epub "http://www.idpf.org/2007/ops";
    html { color-scheme: ${t.scheme}; background: ${t.bg} !important; font-size: ${style.fontPct}%; }
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
  };
  book: {
    metadata?: { title?: unknown; author?: unknown; language?: unknown };
    toc?: { label?: string; href?: string; subitems?: unknown[] }[];
    dir?: string;
    transformTarget?: EventTarget;
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

export type { FoliateView };

export function isFoliateView(value: unknown): value is FoliateView {
  return value instanceof HTMLElement && "open" in value && "goToFraction" in value;
}
