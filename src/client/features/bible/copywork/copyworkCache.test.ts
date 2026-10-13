import assert from "node:assert/strict";
import test from "node:test";
import type { CopyworkData } from "./copyworkCache";
import { createCopyworkCache } from "./copyworkCache";
const manifest = { work: { id: "work", completedAt: "date" }, pages: [[{ index: 0, x: 68, y: 110 }], [{ index: 1, x: 68, y: 110 }]] } as Pick<CopyworkData, "work" | "pages">;
function harness() {
  let session = "session-a"; let now = 0; let denied = false;
  const reads: number[] = []; let auth = 0;
  const disk = new Map<string, Pick<CopyworkData, "glyphs">>();
  const cache = createCopyworkCache({ session: () => session, now: () => now,
    authorize: async () => { auth++; if (denied) throw new Error("forbidden"); return manifest; },
    page: async (_id, page) => { reads.push(page); return { glyphs: [{ index: page }] as CopyworkData["glyphs"] }; },
    read: async (key) => disk.get(key), write: async (key, data) => { disk.set(key, data); } });
  return { cache, reads, disk, auth: () => auth, expire: () => { now += 60001; }, switch: () => { session = "session-b"; }, deny: () => { denied = true; } };
}
test("concurrent mounts load all pages once; remounts retain ink and never flash loading", async () => {
  const h = harness();
  const [a, b] = await Promise.all([h.cache.load(1, "work"), h.cache.load(1, "work")]);
  assert.equal(a, b); assert.deepEqual(h.reads, [0, 1]); assert.equal(h.auth(), 1);
  assert.equal(h.cache.peek(1, "work"), a); assert.equal(await h.cache.load(1, "work"), a);
  assert.equal(h.auth(), 1);
});
test("reload/lease renewal rechecks access and reuses persistent ink instead of fetching pages", async () => {
  const h = harness(); await h.cache.load(1, "work"); h.expire();
  assert.equal(h.cache.peek(1, "work"), undefined);
  await h.cache.load(1, "work"); assert.equal(h.auth(), 2); assert.deepEqual(h.reads, [0, 1]);
  h.switch(); await h.cache.load(1, "work"); assert.equal(h.auth(), 3); assert.equal(h.reads.length, 2);
});
test("revocation prevents cached ink disclosure and other accounts use separate keys", async () => {
  const h = harness(); await h.cache.load(1, "work"); await h.cache.load(2, "work");
  assert.equal(h.disk.size, 2); assert.equal(h.reads.length, 4);
  h.deny(); h.cache.invalidate();
  await assert.rejects(h.cache.load(1, "work"), /forbidden/);
  assert.equal(h.cache.peek(1, "work"), undefined);
});
test("cache storage failures are visible while this session still retains ink", async () => {
  const cache = createCopyworkCache({ session: () => "a", authorize: async () => manifest,
    page: async () => ({ glyphs: [] }), read: async () => { throw new Error("unavailable"); },
    write: async () => { throw new Error("quota"); } });
  const data = await cache.load(1, "work"); assert.match(data.cacheWarning, /未能保存/);
  assert.equal(await cache.load(1, "work"), data);
});
