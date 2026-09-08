import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type {
  BibleCatalogDTO,
  BibleChapterDTO,
  BibleFavoriteDTO,
  BibleFavoriteKeyDTO,
  BibleLookupDTO,
  BibleRelatedSearchDTO,
  BibleTextSearchDTO
} from "../../shared/types.js";
import { APP_VERSION } from "../../shared/release.js";
import { DEFAULT_BIBLE_FAVORITE_COLOR, normalizeBibleFavoriteColor } from "../../shared/bibleFavoriteColors.js";
import { bibleCatalog, lookupBibleChapter, lookupBibleReference, searchBibleText } from "../bible/lookup.js";
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
      query: z.string().min(1).max(200),
      translation: z.string().trim().min(1).max(30).optional()
    }).parse(request.query);
    try {
      const result = searchBibleText(query.query, 0, 40000, 40000, query.translation);
      return { success: true, result };
    } catch {
      return reply.code(400).send({ success: false, message: "搜索失败，请更换译本或关键词后重试" });
    }
  });

  app.get("/api/bible/search", { preHandler: requireAuth }, async (request, reply) => {
    if (applyJsonValidation(request, reply, `W/"bible-${APP_VERSION}"`)) return reply.code(304).send();
    const query = z
      .object({
        query: z.string().min(1).max(200),
        offset: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(50).default(50),
        translation: z.string().trim().min(1).max(30).optional()
      })
      .parse(request.query);
    try {
      const result: BibleTextSearchDTO = searchBibleText(query.query, query.offset, query.limit, 50, query.translation);
      return { success: true, result };
    } catch {
      return reply.code(400).send({ success: false, message: "搜索失败，请更换译本或关键词后重试" });
    }
  });

  app.post("/api/bible/related", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedBibleRequest).auth;
    const body = z.object({
      query: z.string().trim().min(2).max(200),
      excludeReferences: z.array(z.string().trim().min(1).max(120)).max(60).default([])
    }).parse(request.body);
    const loaded = await aiSettings.loadAiSettings();
    const settings = loaded.value;
    const apiKey = aiSettings.decryptAiApiKey(loaded.encryptedApiKey);
    if (!settings.enabled || !apiKey) return reply.code(409).send({ success: false, message: aiConfigurationMessage(auth) });
    if (!bibleTopicSearchAllowed(auth.accountId, settings.userLimitPerMinute)) {
      return reply.code(429).send({ success: false, message: "主题检索太频繁了，请稍后再试。" });
    }
    try {
      const exclusionInstruction = body.excludeReferences.length
        ? `请追加不同的经文，不要重复这些已有出处：${body.excludeReferences.join("、")}。`
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
      const result: BibleRelatedSearchDTO = { query: body.query, results };
      return { success: true, result };
    } catch (error) {
      request.log.warn({ error }, "Bible topic search failed");
      return reply.code(502).send({ success: false, message: auth.isAdmin ? `主题检索失败：${cleanAiError(error)}` : "主题检索暂时不可用，请稍后重试。" });
    }
  });
}
