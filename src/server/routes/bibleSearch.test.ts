import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { brotliDecompressSync } from "node:zlib";
import { createBibleSearchService } from "../services/bibleSearch.js";
import { lookupBibleReference, searchBibleText } from "../bible/lookup.js";
import { registerBibleLookupRoutes } from "./bibleLookup.js";

function database() {
  const rows = new Map<string, { key: string; value: string }>();
  type Filter = { key?: string | { startsWith: string }; OR?: Filter[] };
  function match(key: string, filter: Filter): boolean {
    return filter.OR ? filter.OR.some(part => match(key, part)) : typeof filter.key === "string" ? key === filter.key : key.startsWith(filter.key?.startsWith || "");
  }
  const setting = {
    findUnique: async ({ where }: { where: { key: string } }) => rows.get(where.key) || null,
    findMany: async ({ where }: { where: Filter }) => [...rows.values()].filter(row => match(row.key, where)),
    upsert: async ({ where, create, update }: { where: { key: string }; create: { key: string; value: string }; update: { value?: string } }) => {
      const row = rows.get(where.key);
      const next = row ? { ...row, ...update } : create;
      rows.set(where.key, next); return next;
    },
    update: async ({ where, data }: { where: { key: string }; data: { value: string } }) => {
      const row = { key: where.key, ...data }; rows.set(where.key, row); return row;
    },
    deleteMany: async ({ where }: { where: Filter }) => {
      for (const key of rows.keys()) if (match(key, where)) rows.delete(key);
    },
    createMany: async ({ data }: { data: { key: string; value: string }[] }) => { for (const row of data) rows.set(row.key, row); }
  };
  let tail: Promise<unknown> = Promise.resolve();
  const prisma = {
    setting,
    $transaction: <T>(action: (tx: { setting: typeof setting }) => Promise<T>) => {
      const job = tail.then(() => action({ setting, $queryRaw: async () => [{ id: 1 }] } as { setting: typeof setting })); tail = job.catch(() => undefined); return job;
    }
  } as unknown as PrismaClient;
  return { prisma, rows };
}

test("Bible text cache survives service restart, reuses complete results for pagination/export and separates translations", async () => {
  const { prisma, rows } = database();
  let scans = 0;
  const scan: typeof searchBibleText = (...args) => { scans++; return searchBibleText(...args); };
  const first = createBibleSearchService(prisma, scan);
  const page = await first.text(1, "神", 0, 2);
  const restarted = createBibleSearchService(prisma, scan);
  const next = await restarted.text(2, "  神  ", 2, 2);
  const full = await restarted.text(2, "神", 0, 40000);
  assert.equal(scans, 1);
  assert.deepEqual(page.items, full.items.slice(0, 2));
  assert.deepEqual(next.items, full.items.slice(2, 4));
  assert.equal(full.items.length, full.total);
  assert.ok(full.total > 1000);
  assert.ok([...rows.values()].every(row => Buffer.byteLength(row.value) < 65535));
  const other = await restarted.text(1, "神", 0, 2, "cmncbs");
  assert.equal(other.sourceId, "cmncbs"); assert.equal(scans, 2);
  assert.equal((await first.history(1)).length, 2);
  assert.equal((await first.history(2)).length, 1);
  await first.clearHistory(1);
  assert.deepEqual(await first.history(1), []);
  assert.equal((await first.history(2)).length, 1);
  await assert.rejects(first.text(1, "神", 0, 2, "unknown"), /无效圣经译本/);
});

test("shared scripture caches omit private queries and terms after account history is cleared", async () => {
  const { prisma, rows } = database();
  const service = createBibleSearchService(prisma);
  const query = "private_search_2026";
  await service.text(1, query);
  await service.related(1, query, [], async () => [lookupBibleReference("诗篇23:1")]);
  await service.clearHistory(1);
  for (const row of rows.values()) {
    if (!row.key.startsWith("bible.search.v1.") || /\.\d+$/.test(row.key)) continue;
    const { parts } = JSON.parse(row.value) as { parts: number };
    const encoded = Array.from({ length: parts }, (_, index) => rows.get(`${row.key}.${index}`)!.value).join("");
    const cached = JSON.parse(brotliDecompressSync(Buffer.from(encoded, "base64")).toString("utf8"));
    assert.equal("query" in cached, false);
    assert.equal("terms" in cached, false);
    assert.equal(JSON.stringify(cached).includes(query), false);
  }
  const response = await createBibleSearchService(prisma).text(2, query);
  assert.equal(response.query, query);
  assert.deepEqual(response.terms, [query]);
});

test("Bible topic requests coalesce, reuse appended public results across accounts and do not cache failures", async () => {
  const { prisma } = database();
  const service = createBibleSearchService(prisma);
  let calls = 0;
  const one = lookupBibleReference("约翰福音3:16"), two = lookupBibleReference("诗篇23:1");
  const generate = async (exclude: string[]) => { calls++; return exclude.length ? [two] : [one]; };
  const initial = await Promise.all(Array.from({ length: 8 }, (_, index) => service.related(index + 1, "信心", [], generate)));
  assert.equal(calls, 1); assert.deepEqual(initial[0].results, [one]);
  const appended = await service.related(1, "信心", [one.normalizedReference], generate);
  assert.deepEqual(appended.results, [two]); assert.equal(calls, 2);
  const again = createBibleSearchService(prisma);
  const cached = await again.related(2, "信心", [one.normalizedReference], async () => { throw new Error("must not call AI"); });
  assert.deepEqual(cached.results, [two]);
  await assert.rejects(service.related(1, "失败重试", [], async () => { throw new Error("provider unavailable"); }), /provider unavailable/);
  const recovered = await service.related(1, "失败重试", [], async () => [one]);
  assert.deepEqual(recovered.results, [one]);
  assert.equal((await service.history(8))[0].query, "信心");
});

test("Bible history imports merge rather than overwrite, are bounded and distinguish translations", async () => {
  const { prisma } = database(); const service = createBibleSearchService(prisma);
  await service.related(1, "新记录", [], async () => [lookupBibleReference("诗篇23:1")]);
  const entries = Array.from({ length: 20 }, (_, index) => ({ kind: "text" as const, query: `旧记录${index}`, translation: "cmn-cu89s", count: 1, updatedAt: "2025-01-01T00:00:00.000Z" }));
  const imported = await service.importHistory(1, entries);
  assert.equal(imported.length, 20); assert.equal(imported[0].query, "新记录");
  assert.deepEqual(await service.history(2), []);
  assert.equal((await service.importHistory(1, entries)).length, 20);
});

test("Bible search routes require authentication, validate queries, share cached topic results without AI and isolate history", async () => {
  const { prisma } = database(); const service = createBibleSearchService(prisma);
  const passage = lookupBibleReference("诗篇23:1");
  await service.related(1, "平安", [], async () => [passage]);
  const app = Fastify(); let aiCalls = 0;
  app.setErrorHandler((error, _request, reply) => error instanceof z.ZodError ? reply.code(400).send({ success: false }) : reply.send(error));
  registerBibleLookupRoutes(app, {
    prisma,
    requireAuth: async (request, reply) => {
      const id = Number(request.headers.authorization);
      if (!id) return reply.code(401).send({ success: false });
      Object.assign(request, { auth: { accountId: id, isAdmin: false } });
    },
    aiSettings: { loadAiSettings: async () => { aiCalls++; throw new Error("AI unavailable"); }, decryptAiApiKey: () => "" }
  });
  try {
    for (const [method, url, payload] of [
      ["GET", "/api/bible/search?query=神", undefined], ["GET", "/api/bible/search/history", undefined],
      ["DELETE", "/api/bible/search/history", undefined], ["POST", "/api/bible/related", { query: "平安" }],
      ["POST", "/api/bible/search/history/import", { entries: [] }]
    ] as const) assert.equal((await app.inject({ method, url, payload })).statusCode, 401);
    const response = await app.inject({ method: "POST", url: "/api/bible/related", headers: { authorization: "2" }, payload: { query: "平安" } });
    assert.equal(response.statusCode, 200); assert.deepEqual(response.json().result.results, [passage]); assert.equal(aiCalls, 0);
    const history = await app.inject({ method: "GET", url: "/api/bible/search/history", headers: { authorization: "2" } });
    assert.equal(history.json().history[0].query, "平安"); assert.equal(history.headers["cache-control"], "private, no-store");
    const empty = await app.inject({ method: "GET", url: "/api/bible/search/history", headers: { authorization: "3" } });
    assert.deepEqual(empty.json().history, []);
    for (const url of ["/api/bible/search?query=%20%20", "/api/bible/search?query=神&offset=-1", "/api/bible/search?query=神&translation=unknown"])
      assert.equal((await app.inject({ method: "GET", url, headers: { authorization: "2" } })).statusCode, 400);
  } finally { await app.close(); }
});
