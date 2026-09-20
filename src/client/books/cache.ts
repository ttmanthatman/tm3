import { authHeaders, getToken } from "../api";
import { bookFileUrl } from "./reader";

const CONTENT_CACHE_PREFIX = "team-chat-content-";

export type BookDownloadState = "checking" | "needed" | "downloading" | "ready" | "error";

export function bookClickAction(state: BookDownloadState): "open" | "download" | "wait" {
  if (state === "ready") return "open";
  if (state === "checking" || state === "downloading") return "wait";
  return "download";
}

export function privateContentCacheName(token: string): string {
  try {
    const payload = token.split(".")[1];
    if (!payload) return "";
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const decoded = JSON.parse(atob(normalized)) as { sessionId?: unknown };
    const sessionId = String(decoded.sessionId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
    return sessionId ? `${CONTENT_CACHE_PREFIX}${sessionId}` : "";
  } catch {
    return "";
  }
}

function cacheContext(bookId: number): { cacheName: string; key: Request; url: string } {
  if (!("caches" in window)) throw new Error("当前浏览器不支持离线图书");
  const token = getToken();
  const cacheName = privateContentCacheName(token);
  if (!cacheName) throw new Error("登录状态无效，请重新登录后下载");
  const url = new URL(bookFileUrl(bookId), window.location.origin).href;
  return { cacheName, key: new Request(url, { method: "GET" }), url };
}

export async function isBookDownloaded(bookId: number): Promise<boolean> {
  const { cacheName, key } = cacheContext(bookId);
  return Boolean(await (await caches.open(cacheName)).match(key));
}

export async function downloadBook(
  bookId: number,
  onProgress: (loaded: number, total: number) => void
): Promise<void> {
  const { cacheName, key, url } = cacheContext(bookId);
  const cache = await caches.open(cacheName);
  const cached = await cache.match(key);
  if (cached) {
    const total = Number(cached.headers.get("content-length")) || (await cached.blob()).size;
    onProgress(total, total);
    return;
  }
  const response = await fetch(url, { headers: authHeaders(), credentials: "same-origin" });
  if (!response.ok || response.status !== 200) throw new Error(`图书下载失败（${response.status}）`);
  const total = Number(response.headers.get("content-length")) || 0;
  if (!response.body) {
    const blob = await response.blob();
    await cache.put(key, new Response(blob, { status: 200, headers: response.headers }));
    onProgress(blob.size, total || blob.size);
    return;
  }
  const [cacheBody, progressBody] = response.body.tee();
  const cacheWrite = cache.put(key, new Response(cacheBody, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  }));
  const reader = progressBody.getReader();
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    loaded += value?.byteLength ?? 0;
    onProgress(loaded, total);
  }
  await cacheWrite;
  onProgress(loaded, total || loaded);
}
