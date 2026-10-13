import type { CopyworkDTO, CopyworkGlyph, CopyworkPlacement } from "@shared/bibleCopywork";
import { api, getToken } from "../../../api";

export type CopyworkData = { work: CopyworkDTO; pages: CopyworkPlacement[][]; glyphs: Array<CopyworkGlyph & { index: number }>; cacheWarning: string };
type Manifest = Pick<CopyworkData, "work" | "pages">;
type Ink = Pick<CopyworkData, "glyphs">;
const CACHE = "bible-copywork-ink-v1";
const MAX_BYTES = 64 * 1024 * 1024;
const ACCESS_MS = 60_000;

export function createCopyworkCache(deps: {
  session: () => string;
  authorize: (id: string) => Promise<Manifest>;
  page: (id: string, page: number) => Promise<Ink>;
  read: (key: string) => Promise<Ink | undefined>;
  write: (key: string, ink: Ink) => Promise<void>;
  now?: () => number;
}) {
  const entries = new Map<string, { data: CopyworkData; expires: number; bytes: number }>();
  const pending = new Map<string, Promise<CopyworkData>>();
  const now = deps.now || Date.now;
  let session = "";
  let epoch = 0;
  function reset() { epoch++; entries.clear(); pending.clear(); }
  function key(accountId: number, id: string) {
    const current = deps.session();
    if (current !== session) { session = current; reset(); }
    return `${accountId}/${id}`;
  }
  function peek(accountId: number, id: string) {
    const entry = entries.get(key(accountId, id));
    if (!entry || entry.expires <= now()) return undefined;
    // LRU ordering survives component unmounts; no animation resources live here.
    entries.delete(key(accountId, id));
    entries.set(key(accountId, id), entry);
    return entry.data;
  }
  function load(accountId: number, id: string): Promise<CopyworkData> {
    const k = key(accountId, id);
    const cached = peek(accountId, id);
    if (cached) return Promise.resolve(cached);
    const existing = pending.get(k);
    if (existing) return existing;
    const generation = epoch;
    const expectedSession = session;
    function current() {
      if (generation !== epoch || expectedSession !== deps.session()) throw new Error("登录或作品状态已变化，请重新打开");
    }
    const request = (async () => {
      // Persistent ink is immutable, but access grants are live. Reauthorize on
      // a new session or expired lease before consulting the account-scoped disk cache.
      const manifest = await deps.authorize(id);
      current();
      const diskKey = `/__copywork-ink/${accountId}/${encodeURIComponent(id)}/${encodeURIComponent(manifest.work.completedAt)}`;
      let ink: Ink | undefined;
      let cacheWarning = "";
      try { ink = await deps.read(diskKey); }
      catch { cacheWarning = "本机笔迹缓存不可用，重新打开可能需要再次加载。"; }
      current();
      if (!ink) {
        const glyphs: CopyworkData["glyphs"] = [];
        for (let page = 0; page < manifest.pages.length; page++) {
          current();
          glyphs.push(...(await deps.page(id, page)).glyphs);
        }
        current();
        ink = { glyphs };
        try { await deps.write(diskKey, ink); }
        catch { cacheWarning = "本机笔迹缓存未能保存，重新打开可能需要再次加载。"; }
      }
      current();
      const data = { ...manifest, ...ink, cacheWarning };
      const bytes = JSON.stringify(data).length * 2;
      entries.set(k, { data, bytes, expires: now() + ACCESS_MS });
      let total = [...entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
      while (entries.size > 8 || (total > MAX_BYTES && entries.size > 1)) {
        const oldest = entries.keys().next().value!;
        total -= entries.get(oldest)!.bytes;
        entries.delete(oldest);
      }
      return data;
    })().catch((error: unknown) => { if (generation === epoch) entries.delete(k); throw error; })
      .finally(() => { if (pending.get(k) === request) pending.delete(k); });
    pending.set(k, request);
    return request;
  }
  return { load, peek, invalidate: reset };
}

export const copyworkCache = createCopyworkCache({
  session: getToken,
  authorize: (id) => api<Manifest>(`/api/bible/copyworks/${id}`),
  page: (id, page) => api<Ink>(`/api/bible/copyworks/${id}/pages/${page}`),
  read: async (key) => {
    const response = await (await caches.open(CACHE)).match(key);
    return response ? await response.json() as Ink : undefined;
  },
  write: async (key, ink) => {
    const cache = await caches.open(CACHE);
    const body = JSON.stringify(ink);
    await cache.put(key, new Response(body, { headers: { "Content-Type": "application/json", "X-Ink-Bytes": String(new Blob([body]).size) } }));
    const keys = await cache.keys();
    let total = 0;
    for (const request of [...keys].reverse()) {
      const response = await cache.match(request);
      total += Number(response?.headers.get("X-Ink-Bytes") || MAX_BYTES);
      if (total > MAX_BYTES) await cache.delete(request);
    }
  }
});
if (typeof window !== "undefined") window.addEventListener("bible-copyworks-changed", () => copyworkCache.invalidate());
