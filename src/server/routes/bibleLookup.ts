import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type {
  BibleCatalogDTO,
  BibleChapterDTO,
  BibleFavoriteDTO,
  BibleFavoriteKeyDTO,
  BibleLookupDTO,
  BibleSearchHistoryDTO
} from "../../shared/types.js";
import { APP_VERSION } from "../../shared/release.js";
import { DEFAULT_BIBLE_FAVORITE_COLOR, normalizeBibleFavoriteColor } from "../../shared/bibleFavoriteColors.js";
import { bibleCatalog, lookupBibleChapter, lookupBibleReference } from "../bible/lookup.js";
import { createBibleSearchService } from "../services/bibleSearch.js";
import { applyJsonValidation } from "../fileResponses.js";
import {
  BIBLE_TOPIC_SEARCH_PROMPT,
  aiConfigurationMessage,
  bibleTopicSearchAllowed,
  callDeepSeekBibleReferences,
  cleanAiError,
  type AiSettingsStore
} from "../aiSettings.js";

type BibleAuthContext = {
  accountId: number;
  isAdmin: boolean;
};

type AuthedBibleRequest = FastifyRequest & { auth: BibleAuthContext };

export type BibleLookupRouteDependencies = {
  prisma: PrismaClient;
  requireAuth: preHandlerHookHandler;
  aiSettings: Pick<AiSettingsStore, "loadAiSettings" | "decryptAiApiKey">;
};

const bibleFavoriteKeySchema = z.object({
  bookCode: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  chapter: z.coerce.number().int().positive(),
  verse: z.coerce.number().int().positive()
});

function resolveBibleFavorite(key: BibleFavoriteKeyDTO) {
  const chapter = lookupBibleChapter(key.bookCode, key.chapter);
  const verseLine = chapter.verses.find((verse) => verse.verse === key.verse);
  if (!verseLine) throw new Error("invalid verse");
  return { bookCode: chapter.bookCode, chapter: chapter.chapter, verse: verseLine.verse, verseLine };
}

export function registerBibleLookupRoutes(app: FastifyInstance, deps: BibleLookupRouteDependencies) {
  const { prisma, requireAuth, aiSettings } = deps;
  const search = createBibleSearchService(prisma);
  const accountId = (request: FastifyRequest) => (request as AuthedBibleRequest).auth.accountId;
  app.get("/api/bible/search/history", { preHandler: requireAuth }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    return { success: true, history: await search.history(accountId(request)) };
  });
  app.delete("/api/bible/search/history", { preHandler: requireAuth }, async (request) => ({ success: true, history: await search.clearHistory(accountId(request)) }));
  app.post("/api/bible/search/history/import", { preHandler: requireAuth }, async (request) => {
    const body = z.object({ entries: z.array(z.object({
      kind: z.enum(["topic", "text"]), query: z.string().trim().min(1).max(200),
      translation: z.string().min(1).max(30), updatedAt: z.string().datetime(), count: z.number().int().min(0).max(40000)
    }).strict()).max(20) }).strict().parse(request.body);
    return { success: true, history: await search.importHistory(accountId(request), body.entries as BibleSearchHistoryDTO[]) };
  });

  async function listBibleFavorites(accountId: number): Promise<BibleFavoriteDTO[]> {
    const rows = await prisma.bibleFavorite.findMany({
      where: { accountId },
      orderBy: { createdAt: "desc" },
      take: 1000
    });
    return rows.flatMap((row) => {
      try {
        const resolved = resolveBibleFavorite(row);
        return [{
          id: row.id,
          bookCode: resolved.bookCode,
          chapter: resolved.chapter,
          verse: resolved.verse,
          color: normalizeBibleFavoriteColor(row.color),
          savedAt: row.createdAt.toISOString(),
          verseLine: resolved.verseLine
        }];
      } catch {
        return [];
      }
    });
  }

  app.get("/api/bible/lookup", { preHandler: requireAuth }, async (request, reply) => {
    if (applyJsonValidation(request, reply, `W/"bible-${APP_VERSION}"`)) return reply.code(304).send();
    const query = z.object({ reference: z.string().min(1).max(120) }).parse(request.query);
    try {
      const result: BibleLookupDTO = lookupBibleReference(query.reference);
      return { success: true, result };
    } catch {
      return { success: false, message: "暂时找不到这处经文" };
    }
  });

  app.get("/api/bible/chapter", { preHandler: requireAuth }, async (request, reply) => {
    if (applyJsonValidation(request, reply, `W/"bible-${APP_VERSION}"`)) return reply.code(304).send();
    const query = z.object({
      book: z.string().trim().min(3).max(3),
      chapter: z.coerce.number().int().positive(),
      translation: z.string().trim().min(1).max(30).optional()
    }).parse(request.query);
    try {
      const result: BibleChapterDTO = lookupBibleChapter(query.book, query.chapter, query.translation);
      return { success: true, result };
    } catch {
      return { success: false, message: "暂时找不到这一章经文" };
    }
  });

  app.get("/api/bible/catalog", { preHandler: requireAuth }, async (request, reply) => {
    if (applyJsonValidation(request, reply, `W/"bible-${APP_VERSION}"`)) return reply.code(304).send();
    const result: BibleCatalogDTO = bibleCatalog();
    return { success: true, result };
  });

  app.get("/api/bible/favorites", { preHandler: requireAuth }, async (request) => {
    const auth = (request as AuthedBibleRequest).auth;
    return { success: true, favorites: await listBibleFavorites(auth.accountId) };
  });

  app.post("/api/bible/favorites", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedBibleRequest).auth;
    const body = z.object({
      verses: z.array(bibleFavoriteKeySchema).min(1).max(500),
      color: z.string().optional()
    }).parse(request.body);
    const color = normalizeBibleFavoriteColor(body.color || DEFAULT_BIBLE_FAVORITE_COLOR);
    let verses: ReturnType<typeof resolveBibleFavorite>[];
    try {
      verses = body.verses.map(resolveBibleFavorite);
    } catch {
      return reply.code(400).send({ success: false, message: "收藏中包含无效经文" });
    }
    const verseWhere = verses.map((verse) => ({
      bookCode: verse.bookCode,
      chapter: verse.chapter,
      verse: verse.verse
    }));
    await prisma.$transaction([
      prisma.bibleFavorite.createMany({
        data: verses.map((verse) => ({
          accountId: auth.accountId,
          bookCode: verse.bookCode,
          chapter: verse.chapter,
          verse: verse.verse,
          color
        })),
        skipDuplicates: true
      }),
      prisma.bibleFavorite.updateMany({
        where: { accountId: auth.accountId, OR: verseWhere },
        data: { color }
      })
    ]);
    return { success: true, favorites: await listBibleFavorites(auth.accountId) };
  });

  app.delete("/api/bible/favorites", { preHandler: requireAuth }, async (request) => {
    const auth = (request as AuthedBibleRequest).auth;
    const body = z.object({ verses: z.array(bibleFavoriteKeySchema).min(1).max(500) }).parse(request.body);
    await prisma.bibleFavorite.deleteMany({
      where: {
        accountId: auth.accountId,
        OR: body.verses.map((verse) => ({
          bookCode: verse.bookCode,
          chapter: verse.chapter,
          verse: verse.verse
        }))
      }
    });
    return { success: true, favorites: await listBibleFavorites(auth.accountId) };
  });

  app.get("/api/bible/search/export", { preHandler: requireAuth }, async (request, reply) => {
    const query = z.object({
      query: z.string().trim().min(1).max(200),
      translation: z.string().trim().min(1).max(30).optional()
    }).parse(request.query);
    try {
      const result = await search.text(accountId(request), query.query, 0, 40000, query.translation);
      return { success: true, result };
    } catch (error) {
      request.log.warn({ error }, "Bible text search failed");
      return reply.code(400).send({ success: false, message: "搜索失败，请更换译本或关键词后重试" });
    }
  });

  app.get("/api/bible/search", { preHandler: requireAuth }, async (request, reply) => {
    const query = z
      .object({
        query: z.string().trim().min(1).max(200),
        offset: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(50).default(50),
        translation: z.string().trim().min(1).max(30).optional()
      })
      .parse(request.query);
    try {
      const result = await search.text(accountId(request), query.query, query.offset, query.limit, query.translation);
      return { success: true, result };
    } catch (error) {
      request.log.warn({ error }, "Bible text search failed");
      return reply.code(400).send({ success: false, message: "搜索失败，请更换译本或关键词后重试" });
    }
  });

  app.post("/api/bible/related", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedBibleRequest).auth;
    const body = z.object({
      query: z.string().trim().min(2).max(200),
      excludeReferences: z.array(z.string().trim().min(1).max(120)).max(60).default([])
    }).parse(request.body);
    try {
      const result = await search.related(auth.accountId, body.query, body.excludeReferences, async (excluded) => {
        const loaded = await aiSettings.loadAiSettings();
        const settings = loaded.value;
        const apiKey = aiSettings.decryptAiApiKey(loaded.encryptedApiKey);
        if (!settings.enabled || !apiKey) throw Object.assign(new Error(aiConfigurationMessage(auth)), { statusCode: 409 });
        if (!bibleTopicSearchAllowed(auth.accountId, settings.userLimitPerMinute)) throw Object.assign(new Error("主题检索太频繁了，请稍后再试。"), { statusCode: 429 });
        const exclusionInstruction = excluded.length
          ? `请追加不同的经文，不要重复这些已有出处：${excluded.join("、")}。`
          : "";
        const generated = await callDeepSeekBibleReferences(
          settings,
          apiKey,
          BIBLE_TOPIC_SEARCH_PROMPT,
          `用户想查找关于“${body.query}”的经文。${exclusionInstruction}`,
          10
        );
        const seen = new Set<string>();
        const results: BibleLookupDTO[] = [];
        for (const reference of generated.references) {
          try {
            const lookup = lookupBibleReference(reference);
            if (!lookup.verses.length || seen.has(lookup.normalizedReference)) continue;
            seen.add(lookup.normalizedReference);
            results.push(lookup);
            if (results.length >= 6) break;
          } catch {
            // AI references must resolve against the bundled Bible before being returned.
          }
        }
        if (!results.length) throw new Error("AI did not return locally valid Bible references");
        return results;
      });
      return { success: true, result };
    } catch (error) {
      if (error instanceof Error && "statusCode" in error && (error.statusCode === 409 || error.statusCode === 429)) return reply.code(error.statusCode).send({ success: false, message: error.message });
      request.log.warn({ error }, "Bible topic search failed");
      return reply.code(502).send({ success: false, message: auth.isAdmin ? `主题检索失败：${cleanAiError(error)}` : "主题检索暂时不可用，请稍后重试。" });
    }
  });
}
