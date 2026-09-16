// 登录后的空闲预加载：错峰拉取面板 chunk、图书解析器与在读图书文件。
// 全部静默失败、串行执行，不与首屏渲染和聊天流量竞争。
import { api, getToken } from "../api";
import { bookFileUrl } from "../books/reader";
import type { BookDTO } from "@shared/types";

type IdleTask = () => Promise<unknown>;

// 保守预热：只拉「在读中」（有进度且未读完）的书，最多 3 本、合计不超过 32MB，
// 避免把整个大书架搬进 Service Worker 缓存。
export const IDLE_PRELOAD_BOOK_LIMIT = 3;
export const IDLE_PRELOAD_BOOK_MAX_BYTES = 32 * 1024 * 1024;

export type IdlePreloadConnection = { saveData?: boolean; metered?: boolean } | undefined;

export type IdlePreloadOptions = {
  // 每步执行前检查；登出后（登录态失效）停止后续步骤
  isActive: () => boolean;
  schedule?: (callback: () => void) => void;
  loadPanelChunks?: () => IdleTask[];
  loadBookParsers?: () => IdleTask[];
  fetchBooks?: () => Promise<BookDTO[]>;
  primeResource?: (url: string) => Promise<unknown>;
  connection?: () => IdlePreloadConnection;
  token?: () => string;
};

// 与 App.vue 的 defineAsyncComponent 指向同一批模块，命中同一 chunk；
// immutable 缓存命中时零成本。刻意排除 PdfScoreInline（pdfjs worker 约 1.3MB）
// 与 matter-js（oops 物理层），保持按需加载。
function defaultPanelChunkTasks(): IdleTask[] {
  return [
    () => import("../components/BibleWorkspace.vue"),
    () => import("../components/BookWorkspace.vue"),
    () => import("../components/MusicLyricsHeader.vue"),
    () => import("./music/MusicManager.vue"),
    () => import("./friend/FriendPrograms.vue"),
    () => import("./admin/AdminPanel.vue"),
    () => import("./settings/SettingsPanel.vue"),
    () => import("./reception/ReceptionManager.vue"),
    () => import("./sermon/SermonOverlay.vue"),
    () => import("./sermon/SermonWorkspace.vue"),
    () => import("./sermon/SermonEntryDialog.vue"),
    () => import("./sermon/SermonRequestCard.vue"),
    () => import("./bible/BibleSessionCard.vue"),
    () => import("./chat/ChatRecordCard.vue"),
    () => import("./chat/ChatRecordView.vue")
  ];
}

// 与 reader.ts / BookWorkspace.preloadFoliate 同一 specifier，共享 module map；
// 解析器独立 chunk，更新时只需重下解析器。
function defaultBookParserTasks(): IdleTask[] {
  return [
    () => import("foliate-js/view.js"),
    () => import("@zip.js/zip.js")
  ];
}

async function defaultFetchBooks(): Promise<BookDTO[]> {
  const res = await api<{ success: boolean; books: BookDTO[] }>("/api/books");
  return res.books;
}

// 与音乐预热同一模式：经 SW 的 CACHE_RESOURCE 后台拉取并缓存白名单 URL。
async function defaultPrimeResource(url: string): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.ready.catch(() => null);
  registration?.active?.postMessage({ type: "CACHE_RESOURCE", url });
}

function defaultConnection(): IdlePreloadConnection {
  return (navigator as Navigator & { connection?: { saveData?: boolean; metered?: boolean } }).connection;
}

// Safari 无 requestIdleCallback；timeout 兜底保证长忙页面也能推进队列。
const defaultSchedule: (callback: () => void) => void =
  typeof window !== "undefined" && typeof window.requestIdleCallback === "function"
    ? (callback) => window.requestIdleCallback(callback, { timeout: 5000 })
    : (callback) => window.setTimeout(callback, 1500);

export function pickIdlePreloadBooks(
  books: BookDTO[],
  limit = IDLE_PRELOAD_BOOK_LIMIT,
  maxBytes = IDLE_PRELOAD_BOOK_MAX_BYTES
): BookDTO[] {
  const reading = books
    .filter((book) => typeof book.progress === "number" && book.progress > 0 && book.progress < 0.995)
    .sort((a, b) => b.id - a.id);
  const picked: BookDTO[] = [];
  let bytes = 0;
  for (const book of reading) {
    if (picked.length >= limit) break;
    if (bytes + book.fileSize > maxBytes) continue;
    picked.push(book);
    bytes += book.fileSize;
  }
  return picked;
}

export function scheduleIdlePreload(options: IdlePreloadOptions): Promise<void> {
  const schedule = options.schedule || defaultSchedule;
  const loadPanelChunks = options.loadPanelChunks || defaultPanelChunkTasks;
  const loadBookParsers = options.loadBookParsers || defaultBookParserTasks;
  const fetchBooks = options.fetchBooks || defaultFetchBooks;
  const primeResource = options.primeResource || defaultPrimeResource;
  const connection = options.connection || defaultConnection;
  const token = options.token || getToken;
  const waitIdle = () => new Promise<void>((resolve) => schedule(resolve));

  const run = async () => {
    for (const task of [...loadPanelChunks(), ...loadBookParsers()]) {
      if (!options.isActive()) return;
      await waitIdle();
      await task().catch(() => {});
    }
    // 省流/按流量计费网络只预热代码 chunk，不下载图书文件
    const conn = connection();
    if (conn?.saveData || conn?.metered) return;
    if (!options.isActive() || !token()) return;
    await waitIdle();
    const books = await fetchBooks().catch(() => null);
    if (!books) return;
    for (const book of pickIdlePreloadBooks(books)) {
      if (!options.isActive()) return;
      await waitIdle();
      // 与音乐流相同拼 token 过 requireMediaAuth；SW 按整本拉取，后续 Range 命中缓存
      const url = `${bookFileUrl(book.id)}?token=${encodeURIComponent(token())}`;
      await primeResource(url).catch(() => {});
    }
  };
  return run();
}
