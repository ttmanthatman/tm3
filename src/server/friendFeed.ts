import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { FriendProgramDTO } from "../shared/types.js";

const FRIEND_FEED_URL_DEFAULT = "https://sw1.page/tabs/feed";
const FRIEND_FEED_TTL_MS = 30 * 60 * 1000;
const FRIEND_FETCH_TIMEOUT_MS = 10_000;
const FRIEND_MEDIA_CACHE_MAX_BYTES_DEFAULT = 1024 * 1024 * 1024;
const FRIEND_MEDIA_UA = "team-chat-friend-feed/1.0";

type FetchImpl = typeof fetch;

type RawFriendProgram = {
  id: string;
  seriesId: string;
  seriesTitle: string;
  title: string;
  date: string;
  notes?: string;
  audioUrl: string;
  imageUrl?: string;
};

export type FriendMediaStream = {
  status: number;
  contentType: string;
  contentLength: number | null;
  contentRange: string | null;
  body: ReadableStream<Uint8Array>;
};

export type FriendCachedMedia = {
  filePath: string;
  contentType: string;
  size: number;
};

export type FriendFeedServiceOptions = {
  fetchImpl?: FetchImpl;
  feedUrl?: string;
  cacheDir: string;
  maxCacheBytes?: number;
  ttlMs?: number;
  now?: () => number;
};

export type FriendFeedService = {
  getPrograms(): Promise<FriendProgramDTO[]>;
  isAllowedMediaUrl(raw: string): boolean;
  fetchMediaStream(raw: string, range?: string | null): Promise<FriendMediaStream>;
  resolveCachedMedia(raw: string): FriendCachedMedia | null;
  isCachingMedia(raw: string): boolean;
  storeMediaStream(raw: string, contentType: string, expectedSize: number | null, body: ReadableStream<Uint8Array>): Promise<void>;
};

// ---------------------------------------------------------------------------
// JS 字面量解析（sw1.page 的静态导出 chunk 内嵌 todayItems 数组）
// ---------------------------------------------------------------------------

type JsCursor = { text: string; index: number };

function skipJsWhitespace(cursor: JsCursor) {
  while (cursor.index < cursor.text.length && /\s/.test(cursor.text[cursor.index])) cursor.index += 1;
}

function parseJsString(cursor: JsCursor): string {
  const quote = cursor.text[cursor.index];
  if (quote !== '"' && quote !== "'") throw new Error("unexpected string");
  cursor.index += 1;
  let out = "";
  while (cursor.index < cursor.text.length) {
    const ch = cursor.text[cursor.index];
    if (ch === quote) {
      cursor.index += 1;
      return out;
    }
    if (ch === "\\") {
      const next = cursor.text[cursor.index + 1];
      if (next === "u") {
        out += String.fromCodePoint(parseInt(cursor.text.slice(cursor.index + 2, cursor.index + 6), 16));
        cursor.index += 6;
      } else if (next === "x") {
        out += String.fromCodePoint(parseInt(cursor.text.slice(cursor.index + 2, cursor.index + 4), 16));
        cursor.index += 4;
      } else {
        const escapes: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", "0": "\0" };
        out += escapes[next] ?? next;
        cursor.index += 2;
      }
      continue;
    }
    out += ch;
    cursor.index += 1;
  }
  throw new Error("unterminated string");
}

function parseJsIdentifier(cursor: JsCursor): string {
  const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(cursor.text.slice(cursor.index));
  if (!match) throw new Error("unexpected identifier");
  cursor.index += match[0].length;
  return match[0];
}

function parseJsNumber(cursor: JsCursor): number {
  const match = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(cursor.text.slice(cursor.index));
  if (!match) throw new Error("unexpected number");
  cursor.index += match[0].length;
  return Number(match[0]);
}

function parseJsValue(cursor: JsCursor): unknown {
  skipJsWhitespace(cursor);
  const ch = cursor.text[cursor.index];
  if (ch === '"' || ch === "'") return parseJsString(cursor);
  if (ch === "[") return parseJsArray(cursor);
  if (ch === "{") return parseJsObject(cursor);
  if (ch === "-" || /\d/.test(ch)) return parseJsNumber(cursor);
  const word = parseJsIdentifier(cursor);
  if (word === "true") return true;
  if (word === "false") return false;
  if (word === "null") return null;
  if (word === "undefined") return undefined;
  throw new Error(`unsupported literal ${word}`);
}

function parseJsArray(cursor: JsCursor): unknown[] {
  cursor.index += 1; // [
  const out: unknown[] = [];
  for (;;) {
    skipJsWhitespace(cursor);
    if (cursor.text[cursor.index] === "]") {
      cursor.index += 1;
      return out;
    }
    out.push(parseJsValue(cursor));
    skipJsWhitespace(cursor);
    if (cursor.text[cursor.index] === ",") {
      cursor.index += 1;
      continue;
    }
    if (cursor.text[cursor.index] === "]") {
      cursor.index += 1;
      return out;
    }
    throw new Error("unexpected array separator");
  }
}

function parseJsObject(cursor: JsCursor): Record<string, unknown> {
  cursor.index += 1; // {
  const out: Record<string, unknown> = {};
  for (;;) {
    skipJsWhitespace(cursor);
    if (cursor.text[cursor.index] === "}") {
      cursor.index += 1;
      return out;
    }
    const key = cursor.text[cursor.index] === '"' || cursor.text[cursor.index] === "'"
      ? parseJsString(cursor)
      : parseJsIdentifier(cursor);
    skipJsWhitespace(cursor);
    if (cursor.text[cursor.index] !== ":") throw new Error("unexpected object key");
    cursor.index += 1;
    out[key] = parseJsValue(cursor);
    skipJsWhitespace(cursor);
    if (cursor.text[cursor.index] === ",") {
      cursor.index += 1;
      continue;
    }
    if (cursor.text[cursor.index] === "}") {
      cursor.index += 1;
      return out;
    }
    throw new Error("unexpected object separator");
  }
}

function extractJsArrayLiteral(text: string, marker: string): string | null {
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = text.indexOf("[", markerIndex + marker.length);
  if (start < 0) return null;
  let depth = 0;
  let index = start;
  while (index < text.length) {
    const ch = text[index];
    if (ch === '"' || ch === "'") {
      const cursor = { text, index };
      try {
        parseJsString(cursor);
      } catch {
        return null;
      }
      index = cursor.index;
      continue;
    }
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
    index += 1;
  }
  return null;
}

// ---------------------------------------------------------------------------
// feed HTML / chunk 解析
// ---------------------------------------------------------------------------

export function extractFriendChunkUrls(html: string, baseUrl: string): string[] {
  const urls: string[] = [];
  for (const match of html.matchAll(/<script\b[^>]*\bsrc="([^"]+\.js)"[^>]*>/gi)) {
    try {
      const url = new URL(match[1], baseUrl);
      if (url.protocol === "https:" || url.protocol === "http:") urls.push(url.toString());
    } catch {
      // 忽略无效地址
    }
  }
  return urls;
}

function stripFriendNotesHtml(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const text = value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text || undefined;
}

function rawString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseFriendPrograms(jsText: string): RawFriendProgram[] {
  const literal = extractJsArrayLiteral(jsText, "todayItems:");
  if (!literal) return [];
  let items: unknown[];
  try {
    items = parseJsArray({ text: literal, index: 0 });
  } catch {
    return [];
  }
  const programs: RawFriendProgram[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const id = rawString(record.sermon_id);
    const audioUrl = rawString(record.url);
    if (!id || !audioUrl) continue;
    programs.push({
      id,
      seriesId: rawString(record.series_id),
      seriesTitle: rawString(record.series_title),
      title: rawString(record.sermon_title) || rawString(record.series_title),
      date: rawString(record.sermon_publish_up),
      notes: stripFriendNotesHtml(record.sermon_notes),
      audioUrl,
      imageUrl: rawString(record.avatar_sq) || undefined
    });
  }
  return programs;
}

// ---------------------------------------------------------------------------
// 媒体地址白名单与缓存
// ---------------------------------------------------------------------------

const FRIEND_MEDIA_HOST = "txly2.net";
const FRIEND_MEDIA_PATH_PREFIXES = ["/ly/audio/", "/images/"];

export function isAllowedFriendMediaUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.hostname.toLowerCase() !== FRIEND_MEDIA_HOST) return false;
  if (parsed.username || parsed.password) return false;
  return FRIEND_MEDIA_PATH_PREFIXES.some((prefix) => parsed.pathname.startsWith(prefix));
}

function friendMediaCacheKey(raw: string) {
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

function friendMediaContentType(raw: string, fallback = "application/octet-stream") {
  const pathname = new URL(raw).pathname.toLowerCase();
  if (pathname.endsWith(".mp3")) return "audio/mpeg";
  if (pathname.endsWith(".m4a")) return "audio/mp4";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
  if (pathname.endsWith(".webp")) return "image/webp";
  return fallback;
}

type FriendMediaCacheMeta = {
  url: string;
  contentType: string;
  size: number;
  cachedAt: number;
};

function proxyMediaPath(raw: string) {
  return `/api/friend/media?u=${encodeURIComponent(raw)}`;
}

export function createFriendFeedService(options: FriendFeedServiceOptions): FriendFeedService {
  const fetchImpl = options.fetchImpl || fetch;
  const feedUrl = options.feedUrl || process.env.FRIEND_FEED_URL || FRIEND_FEED_URL_DEFAULT;
  const cacheDir = options.cacheDir;
  const maxCacheBytes = Math.max(0, options.maxCacheBytes ?? (Number(process.env.FRIEND_CACHE_MAX_BYTES) || FRIEND_MEDIA_CACHE_MAX_BYTES_DEFAULT));
  const ttlMs = options.ttlMs ?? FRIEND_FEED_TTL_MS;
  const now = options.now || Date.now;

  let cached: { at: number; programs: FriendProgramDTO[] } | null = null;
  let refreshing: Promise<FriendProgramDTO[]> | null = null;
  const inflightDownloads = new Set<string>();

  async function fetchText(url: string, accept: string) {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(FRIEND_FETCH_TIMEOUT_MS),
      headers: { accept, "user-agent": FRIEND_MEDIA_UA }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }

  async function loadPrograms(): Promise<FriendProgramDTO[]> {
    const html = await fetchText(feedUrl, "text/html,application/xhtml+xml");
    const chunkUrls = extractFriendChunkUrls(html, feedUrl);
    for (const chunkUrl of [...chunkUrls].reverse()) {
      const js = await fetchText(chunkUrl, "text/javascript,*/*").catch(() => "");
      if (!js) continue;
      const raw = parseFriendPrograms(js);
      if (!raw.length) continue;
      return raw.map((program) => ({
        id: program.id,
        seriesId: program.seriesId,
        seriesTitle: program.seriesTitle,
        title: program.title,
        date: program.date,
        notes: program.notes,
        audioUrl: proxyMediaPath(program.audioUrl),
        imageUrl: program.imageUrl ? proxyMediaPath(program.imageUrl) : undefined
      }));
    }
    throw new Error("节目单抓取失败");
  }

  async function refreshPrograms(): Promise<FriendProgramDTO[]> {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const programs = await loadPrograms();
        cached = { at: now(), programs };
        return programs;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  async function getPrograms(): Promise<FriendProgramDTO[]> {
    if (cached && now() - cached.at < ttlMs) return cached.programs;
    try {
      return await refreshPrograms();
    } catch (error) {
      if (cached) return cached.programs;
      throw error instanceof Error ? error : new Error("节目单抓取失败");
    }
  }

  function cachePaths(raw: string) {
    const key = friendMediaCacheKey(raw);
    return {
      key,
      bin: path.join(cacheDir, `${key}.bin`),
      tmp: path.join(cacheDir, `${key}.tmp`),
      meta: path.join(cacheDir, `${key}.json`)
    };
  }

  function resolveCachedMedia(raw: string): FriendCachedMedia | null {
    const paths = cachePaths(raw);
    try {
      if (!fs.existsSync(paths.bin) || !fs.existsSync(paths.meta)) return null;
      const meta = JSON.parse(fs.readFileSync(paths.meta, "utf8")) as FriendMediaCacheMeta;
      const stat = fs.statSync(paths.bin);
      if (!stat.isFile() || stat.size !== meta.size) return null;
      return { filePath: paths.bin, contentType: meta.contentType || friendMediaContentType(raw), size: stat.size };
    } catch {
      return null;
    }
  }

  function evictOverflow() {
    let entries: Array<{ key: string; size: number; cachedAt: number }> = [];
    try {
      entries = fs.readdirSync(cacheDir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => {
          try {
            const meta = JSON.parse(fs.readFileSync(path.join(cacheDir, name), "utf8")) as FriendMediaCacheMeta;
            const binName = `${path.basename(name, ".json")}.bin`;
            if (!fs.existsSync(path.join(cacheDir, binName))) return null;
            return { key: path.basename(name, ".json"), size: meta.size, cachedAt: meta.cachedAt || 0 };
          } catch {
            return null;
          }
        })
        .filter((entry): entry is { key: string; size: number; cachedAt: number } => Boolean(entry));
    } catch {
      return;
    }
    let total = entries.reduce((sum, entry) => sum + entry.size, 0);
    for (const entry of entries.sort((a, b) => a.cachedAt - b.cachedAt)) {
      if (total <= maxCacheBytes) break;
      try {
        fs.unlinkSync(path.join(cacheDir, `${entry.key}.bin`));
        fs.unlinkSync(path.join(cacheDir, `${entry.key}.json`));
      } catch {
        // 删除失败时跳过
      }
      total -= entry.size;
    }
  }

  async function storeMediaStream(raw: string, contentType: string, expectedSize: number | null, body: ReadableStream<Uint8Array>) {
    const paths = cachePaths(raw);
    if (inflightDownloads.has(paths.key)) {
      await body.cancel().catch(() => undefined);
      return;
    }
    inflightDownloads.add(paths.key);
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      let received = 0;
      await new Promise<void>((resolve, reject) => {
        const writer = fs.createWriteStream(paths.tmp);
        const reader = Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]);
        reader.on("data", (chunk: Buffer) => {
          received += chunk.byteLength;
        });
        reader.on("error", reject);
        writer.on("error", reject);
        writer.on("finish", () => resolve());
        reader.pipe(writer);
      });
      if (expectedSize !== null && received !== expectedSize) {
        fs.unlinkSync(paths.tmp);
        return;
      }
      fs.renameSync(paths.tmp, paths.bin);
      const meta: FriendMediaCacheMeta = {
        url: raw,
        contentType: contentType || friendMediaContentType(raw),
        size: received,
        cachedAt: now()
      };
      fs.writeFileSync(paths.meta, JSON.stringify(meta));
      evictOverflow();
    } catch {
      try {
        fs.unlinkSync(paths.tmp);
      } catch {
        // 忽略清理失败
      }
    } finally {
      inflightDownloads.delete(paths.key);
    }
  }

  async function fetchMediaStream(raw: string, range?: string | null): Promise<FriendMediaStream> {
    if (!isAllowedFriendMediaUrl(raw)) throw new Error("不支持的媒体地址");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FRIEND_FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetchImpl(raw, {
        signal: controller.signal,
        headers: {
          accept: "*/*",
          "user-agent": FRIEND_MEDIA_UA,
          ...(range ? { range } : {})
        }
      });
    } finally {
      clearTimeout(timeout);
    }
    if (response.status !== 200 && response.status !== 206) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`上游媒体读取失败：HTTP ${response.status}`);
    }
    if (!response.body) throw new Error("上游媒体内容为空");
    const contentLength = Number(response.headers.get("content-length") || "");
    return {
      status: response.status,
      contentType: response.headers.get("content-type") || friendMediaContentType(raw),
      contentLength: Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null,
      contentRange: response.headers.get("content-range"),
      body: response.body as ReadableStream<Uint8Array>
    };
  }

  return {
    getPrograms,
    isAllowedMediaUrl: isAllowedFriendMediaUrl,
    fetchMediaStream,
    resolveCachedMedia,
    isCachingMedia: (raw: string) => inflightDownloads.has(cachePaths(raw).key),
    storeMediaStream
  };
}
