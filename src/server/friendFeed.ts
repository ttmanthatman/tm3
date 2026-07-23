import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { FriendCategoryDTO, FriendProgramDTO } from "../shared/types.js";

const FRIEND_API_BASE_DEFAULT = "https://x.lydt.work/api";
const FRIEND_FEED_REFRESH_HOURS = [7, 19] as const;
const FRIEND_FETCH_TIMEOUT_MS = 10_000;
const FRIEND_MEDIA_CACHE_MAX_BYTES_DEFAULT = 1024 * 1024 * 1024;
const FRIEND_MEDIA_UA = "team-chat-friend-feed/1.0";
const FRIEND_SERIES_ALIAS_PATTERN = /^[a-z0-9]{1,32}$/i;

/** 下一次节目单刷新时刻（本地时间 7:00 或 19:00） */
export function nextFriendFeedRefreshAt(afterMs: number): number {
  for (const hour of FRIEND_FEED_REFRESH_HOURS) {
    const candidate = new Date(afterMs);
    candidate.setHours(hour, 0, 0, 0);
    if (candidate.getTime() > afterMs) return candidate.getTime();
  }
  const nextDay = new Date(afterMs);
  nextDay.setDate(nextDay.getDate() + 1);
  nextDay.setHours(FRIEND_FEED_REFRESH_HOURS[0], 0, 0, 0);
  return nextDay.getTime();
}

type FetchImpl = typeof fetch;

type RawFriendProgram = {
  id: string;
  seriesId: string;
  seriesTitle: string;
  title: string;
  date: string;
  audioUrl: string;
  imageUrl?: string;
};

type RawFriendSeries = {
  id: string;
  alias: string;
  title: string;
  description?: string;
};

type RawFriendCategory = {
  id: string;
  title: string;
  series: RawFriendSeries[];
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
  apiBase?: string;
  cacheDir: string;
  maxCacheBytes?: number;
  ttlMs?: number;
  now?: () => number;
};

export type FriendFeedService = {
  getPrograms(): Promise<FriendProgramDTO[]>;
  getCategories(): Promise<FriendCategoryDTO[]>;
  getSeriesPrograms(alias: string): Promise<FriendProgramDTO[]>;
  refreshAll(): Promise<void>;
  isAllowedMediaUrl(raw: string): boolean;
  fetchMediaStream(raw: string, range?: string | null): Promise<FriendMediaStream>;
  resolveCachedMedia(raw: string): FriendCachedMedia | null;
  isCachingMedia(raw: string): boolean;
  storeMediaStream(raw: string, contentType: string, expectedSize: number | null, body: ReadableStream<Uint8Array>): Promise<void>;
};

// ---------------------------------------------------------------------------
// 上游 JSON API 解析（x.lydt.work：today / categories / program/{alias}）
// ---------------------------------------------------------------------------

function rawString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function rawRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function rawArray(payload: unknown): unknown[] {
  const data = rawRecord(payload).data;
  return Array.isArray(data) ? data : [];
}

export function parseFriendApiTracks(payload: unknown): RawFriendProgram[] {
  const programs: RawFriendProgram[] = [];
  for (const item of rawArray(payload)) {
    const record = rawRecord(item);
    const id = rawString(record.id);
    const mediaPath = rawString(record.path);
    const series = rawRecord(record.program);
    const code = rawString(series.code).toLowerCase();
    if (!id || !mediaPath.startsWith("/ly/audio/")) continue;
    const audioUrl = `https://${FRIEND_AUDIO_HOST}${mediaPath}`;
    if (!isAllowedFriendMediaUrl(audioUrl)) continue;
    programs.push({
      id,
      seriesId: rawString(series.id),
      seriesTitle: rawString(series.name),
      title: rawString(record.description) || rawString(series.name),
      date: rawString(record.play_at).slice(0, 10),
      audioUrl,
      imageUrl: friendSeriesImageUrl(code)
    });
  }
  return programs;
}

export function parseFriendApiCategories(payload: unknown): RawFriendCategory[] {
  const categories: RawFriendCategory[] = [];
  for (const item of rawArray(payload)) {
    const record = rawRecord(item);
    const series: RawFriendSeries[] = [];
    const rawPrograms = record.programs;
    if (!Array.isArray(rawPrograms)) continue;
    for (const rawSeries of rawPrograms) {
      const seriesRecord = rawRecord(rawSeries);
      const alias = rawString(seriesRecord.alias);
      if (!alias || !FRIEND_SERIES_ALIAS_PATTERN.test(alias)) continue;
      series.push({
        id: rawString(seriesRecord.id),
        alias,
        title: rawString(seriesRecord.name),
        description: rawString(seriesRecord.description) || undefined
      });
    }
    if (!series.length) continue;
    categories.push({
      id: rawString(record.id),
      title: rawString(record.name),
      series
    });
  }
  return categories;
}

// ---------------------------------------------------------------------------
// 媒体地址白名单与缓存
// ---------------------------------------------------------------------------

const FRIEND_AUDIO_HOST = "txly2.net";
const FRIEND_COVER_HOST = "d3ml8yyp1h3hy5.cloudfront.net";
const FRIEND_MEDIA_ALLOWLIST: Array<{ host: string; pathPrefixes: string[] }> = [
  { host: FRIEND_AUDIO_HOST, pathPrefixes: ["/ly/audio/", "/images/"] },
  { host: FRIEND_COVER_HOST, pathPrefixes: ["/ly/image/cover/"] }
];

export function isAllowedFriendMediaUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase();
  return FRIEND_MEDIA_ALLOWLIST.some((entry) =>
    entry.host === host && entry.pathPrefixes.some((prefix) => parsed.pathname.startsWith(prefix))
  );
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

export function friendMediaProxyPath(raw: string) {
  return `/api/friend/media?u=${encodeURIComponent(raw)}`;
}

function friendSeriesImageUrl(code: string): string | undefined {
  if (!FRIEND_SERIES_ALIAS_PATTERN.test(code)) return undefined;
  return `https://${FRIEND_COVER_HOST}/ly/image/cover/${code.toLowerCase()}.jpg`;
}

function toProgramDTO(program: RawFriendProgram): FriendProgramDTO {
  return {
    id: program.id,
    seriesId: program.seriesId,
    seriesTitle: program.seriesTitle,
    title: program.title,
    date: program.date,
    audioUrl: friendMediaProxyPath(program.audioUrl),
    imageUrl: program.imageUrl ? friendMediaProxyPath(program.imageUrl) : undefined
  };
}

export function createFriendFeedService(options: FriendFeedServiceOptions): FriendFeedService {
  const fetchImpl = options.fetchImpl || fetch;
  const apiBase = (options.apiBase || process.env.FRIEND_API_BASE || FRIEND_API_BASE_DEFAULT).replace(/\/+$/, "");
  const cacheDir = options.cacheDir;
  const maxCacheBytes = Math.max(0, options.maxCacheBytes ?? (Number(process.env.FRIEND_CACHE_MAX_BYTES) || FRIEND_MEDIA_CACHE_MAX_BYTES_DEFAULT));
  const ttlMs = options.ttlMs;
  const now = options.now || Date.now;

  const inflightDownloads = new Set<string>();

  async function fetchJson(url: string): Promise<unknown> {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(FRIEND_FETCH_TIMEOUT_MS),
      headers: { accept: "application/json", "user-agent": FRIEND_MEDIA_UA }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function createCachedList<T>(load: () => Promise<T[]>, failureMessage: string) {
    let cached: { expiresAt: number; items: T[] } | null = null;
    let refreshing: Promise<T[]> | null = null;
    async function refresh(): Promise<T[]> {
      if (!refreshing) {
        refreshing = (async () => {
          try {
            const items = await load();
            const loadedAt = now();
            cached = { expiresAt: ttlMs !== undefined ? loadedAt + ttlMs : nextFriendFeedRefreshAt(loadedAt), items };
            return items;
          } finally {
            refreshing = null;
          }
        })();
      }
      return refreshing;
    }
    async function get(): Promise<T[]> {
      if (cached && now() < cached.expiresAt) return cached.items;
      try {
        return await refresh();
      } catch (error) {
        if (cached) return cached.items;
        throw error instanceof Error ? error : new Error(failureMessage);
      }
    }
    return { get, refresh };
  }

  const todayList = createCachedList(
    async () => {
      const raw = parseFriendApiTracks(await fetchJson(`${apiBase}/today`));
      if (!raw.length) throw new Error("节目单抓取失败");
      return raw.map(toProgramDTO);
    },
    "节目单抓取失败"
  );
  const getPrograms = todayList.get;

  const categoryList = createCachedList(
    async (): Promise<FriendCategoryDTO[]> => {
      const raw = parseFriendApiCategories(await fetchJson(`${apiBase}/categories`));
      if (!raw.length) throw new Error("节目分类抓取失败");
      return raw.map((category) => ({
        id: category.id,
        title: category.title,
        series: category.series.map((series) => {
          const imageUrl = friendSeriesImageUrl(series.alias);
          return {
            id: series.id,
            alias: series.alias,
            title: series.title,
            description: series.description,
            imageUrl: imageUrl ? friendMediaProxyPath(imageUrl) : undefined
          };
        })
      }));
    },
    "节目分类抓取失败"
  );
  const getCategories = categoryList.get;

  const seriesProgramsLoaders = new Map<string, ReturnType<typeof createCachedList<FriendProgramDTO>>>();

  function getSeriesPrograms(alias: string): Promise<FriendProgramDTO[]> {
    const normalized = alias.trim().toLowerCase();
    if (!FRIEND_SERIES_ALIAS_PATTERN.test(normalized)) return Promise.reject(new Error("不支持的节目系列"));
    let loader = seriesProgramsLoaders.get(normalized);
    if (!loader) {
      loader = createCachedList(
        async () => {
          const raw = parseFriendApiTracks(await fetchJson(`${apiBase}/program/${encodeURIComponent(normalized)}`));
          if (!raw.length) throw new Error("节目列表抓取失败");
          return raw.map(toProgramDTO);
        },
        "节目列表抓取失败"
      );
      seriesProgramsLoaders.set(normalized, loader);
    }
    return loader.get();
  }

  /** 定时刷新（本地 7:00 / 19:00）：强制重取今日节目与分类，并清空系列缓存 */
  async function refreshAll(): Promise<void> {
    seriesProgramsLoaders.clear();
    const results = await Promise.allSettled([todayList.refresh(), categoryList.refresh()]);
    for (const result of results) {
      if (result.status === "rejected") console.error("[friend-feed] 定时刷新失败", result.reason);
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
    getCategories,
    getSeriesPrograms,
    refreshAll,
    isAllowedMediaUrl: isAllowedFriendMediaUrl,
    fetchMediaStream,
    resolveCachedMedia,
    isCachingMedia: (raw: string) => inflightDownloads.has(cachePaths(raw).key),
    storeMediaStream
  };
}
