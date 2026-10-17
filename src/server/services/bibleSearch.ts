import { createHash } from "node:crypto";
import { brotliCompress, brotliDecompress, constants } from "node:zlib";
import { promisify } from "node:util";
import type { PrismaClient, Prisma } from "@prisma/client";
import type { BibleLookupDTO, BibleRelatedSearchDTO, BibleSearchHistoryDTO, BibleTextSearchDTO } from "../../shared/types.js";
import { APP_VERSION } from "../../shared/release.js";
import { bibleTranslations, searchBibleText } from "../bible/lookup.js";

const compress = promisify(brotliCompress), decompress = promisify(brotliDecompress);
const normalize = (query: string) => query.trim().replace(/\s+/g, " ").toLowerCase();
const digest = (input: string) => createHash("sha256").update(input).digest("hex").slice(0, 40);
const historyKey = (accountId: number) => `bible.search.history.${accountId}`;
const cacheKey = (kind: string, query: string, translation: string) => `bible.search.v1.${digest(JSON.stringify([APP_VERSION, kind, normalize(query), translation]))}`;
const PART_SIZE = 48000;
type Database = Pick<PrismaClient, "setting" | "$transaction">;

// Cache only server-generated public scripture. Account history stores no result bodies.
// Compressed parts keep even a whole-Bible export below MySQL TEXT's per-row limit.
export function createBibleSearchService(prisma: Database, scan = searchBibleText) {
  const pending = new Map<string, Promise<unknown>>();
  async function serial<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = pending.get(key);
    const job = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(action);
    pending.set(key, job);
    try { return await job; }
    finally { if (pending.get(key) === job) pending.delete(key); }
  }
  async function read<T>(key: string): Promise<T | null> {
    const rows = await prisma.setting.findMany({ where: { OR: [{ key }, { key: { startsWith: `${key}.` } }] }, select: { key: true, value: true } });
    const row = rows.find(item => item.key === key);
    if (!row) return null;
    const { parts } = JSON.parse(row.value) as { parts: number };
    if (!Number.isInteger(parts) || parts < 1 || parts > 1000) throw new Error("Invalid Bible search cache");
    const values = new Map(rows.map((part) => [part.key, part.value]));
    const bytes = Array.from({ length: parts }, (_, index) => {
      const value = values.get(`${key}.${index}`);
      if (value === undefined) throw new Error("Incomplete Bible search cache");
      return value;
    }).join("");
    return JSON.parse((await decompress(Buffer.from(bytes, "base64"))).toString("utf8")) as T;
  }
  async function write(key: string, result: BibleRelatedSearchDTO | BibleTextSearchDTO) {
    const publicResult = { ...result, query: undefined, terms: undefined };
    const encoded = (await compress(Buffer.from(JSON.stringify(publicResult)), { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } })).toString("base64");
    const parts = Array.from({ length: Math.ceil(encoded.length / PART_SIZE) }, (_, i) => ({ key: `${key}.${i}`, value: encoded.slice(i * PART_SIZE, (i + 1) * PART_SIZE) }));
    await prisma.$transaction(async (tx) => {
      await tx.setting.upsert({ where: { key }, create: { key, value: JSON.stringify({ parts: parts.length }) }, update: { key } });
      await tx.setting.deleteMany({ where: { key: { startsWith: `${key}.` } } });
      await tx.setting.createMany({ data: parts });
      await tx.setting.update({ where: { key }, data: { value: JSON.stringify({ parts: parts.length }) } });
    });
  }
  function translation(id?: string) {
    const resolved = id || bibleTranslations()[0].id;
    if (!bibleTranslations().some((item) => item.id === resolved)) throw Object.assign(new Error("无效圣经译本"), { statusCode: 400 });
    return resolved;
  }
  async function mutateHistory(accountId: number, mutate: (history: BibleSearchHistoryDTO[]) => BibleSearchHistoryDTO[]) {
    const key = historyKey(accountId);
    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const accounts = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM accounts WHERE id = ${accountId} FOR UPDATE`;
      if (!accounts.length) throw Object.assign(new Error("账号已不可用"), { statusCode: 401 });
      const row = await tx.setting.upsert({ where: { key }, create: { key, value: "[]" }, update: { key } });
      const next = mutate(JSON.parse(row.value) as BibleSearchHistoryDTO[]).slice(0, 20);
      await tx.setting.update({ where: { key }, data: { value: JSON.stringify(next) } });
      return next;
    });
  }
  async function record(accountId: number, entry: Omit<BibleSearchHistoryDTO, "updatedAt">) {
    await mutateHistory(accountId, (history) => [{ ...entry, updatedAt: new Date().toISOString() }, ...history.filter((item) => item.kind !== entry.kind || item.translation !== entry.translation || normalize(item.query) !== normalize(entry.query))]);
  }
  return {
    async text(accountId: number, query: string, offset = 0, limit = 50, translationId?: string) {
      const id = translation(translationId), key = cacheKey("text", query, id);
      const full = await serial(key, async () => {
        const cached = await read<BibleTextSearchDTO>(key);
        if (cached) return cached;
        const result = scan(query, 0, 40000, 40000, id);
        await write(key, result);
        return result;
      });
      await record(accountId, { kind: "text", query: query.trim(), translation: id, count: full.total });
      return { ...full, query: query.trim(), terms: full.mode === "allTerms" ? normalize(query).split(/\s+/) : [normalize(query)], offset, limit, items: full.items.slice(offset, offset + limit) };
    },
    async related(accountId: number, query: string, excluded: string[], generate: (exclude: string[]) => Promise<BibleLookupDTO[]>) {
      const id = translation(), key = cacheKey("topic", query, id);
      const result = await serial(key, async () => {
        const cached = await read<BibleRelatedSearchDTO>(key);
        const excludes = new Set(excluded);
        let available = cached?.results.filter((item) => !excludes.has(item.normalizedReference)) || [];
        if (!available.length) {
          const all = [...new Set([...(cached?.results.map((item) => item.normalizedReference) || []), ...excluded])];
          const generated = await generate(all);
          const merged = [...(cached?.results || [])];
          const seen = new Set(merged.map((item) => item.normalizedReference));
          for (const item of generated) if (!seen.has(item.normalizedReference)) { seen.add(item.normalizedReference); merged.push(item); }
          available = merged.filter((item) => !excludes.has(item.normalizedReference));
          if (!available.length) throw new Error("没有找到新的相关经文，请换一个主题");
          await write(key, { query: query.trim(), results: merged });
        }
        return { query: query.trim(), results: excluded.length ? available.slice(0, 6) : available };
      });
      await record(accountId, { kind: "topic", query: query.trim(), translation: id, count: new Set([...excluded, ...result.results.map(item => item.normalizedReference)]).size });
      return result;
    },
    async history(accountId: number): Promise<BibleSearchHistoryDTO[]> {
      const row = await prisma.setting.findUnique({ where: { key: historyKey(accountId) } });
      return row ? JSON.parse(row.value) as BibleSearchHistoryDTO[] : [];
    },
    clearHistory: (accountId: number) => mutateHistory(accountId, () => []),
    importHistory: (accountId: number, entries: BibleSearchHistoryDTO[]) => mutateHistory(accountId, (history) => {
      const merged = [...history];
      for (const entry of entries) {
        translation(entry.translation);
        if (!merged.some((item) => item.kind === entry.kind && item.translation === entry.translation && normalize(item.query) === normalize(entry.query))) merged.push(entry);
      }
      return merged.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    })
  };
}
