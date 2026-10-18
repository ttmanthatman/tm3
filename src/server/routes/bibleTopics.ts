import { Prisma, type PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import sanitizeHtml from "sanitize-html";
import {
  BIBLE_TOPIC_NAME_MAX,
  BIBLE_TOPIC_PASSAGE_MAX,
  BIBLE_TOPIC_REFERENCE_MAX,
  type BibleTopicDTO,
  type BibleTopicPassageDTO
} from "../../shared/bibleTopics.js";
import { bibleTopicEntryPassage, defaultBibleTranslationName, parseBibleTopicPassages } from "../bible/lookup.js";
import { pushOriginFromHeaders } from "../pushOrigin.js";
import type { AuthedBibleRequest, BibleRouteDependencies } from "./bible.js";

const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
const BIBLE_TOPIC_COUNT_MAX = 100;

const nameSchema = z.string().trim().min(1).max(BIBLE_TOPIC_NAME_MAX);
const entryInclude = { entries: { orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }] } };

type TopicEntryRow = {
  id: number;
  bookCode: string;
  startChapter: number;
  startVerse: number;
  endChapter: number;
  endVerse: number;
};

type TopicRow = { id: number; name: string; createdAt: Date; updatedAt: Date; accountId?: number; entries: TopicEntryRow[] };

function escapeTopicContentText(text: string) {
  return sanitizeHtml(text, { allowedTags: [], allowedAttributes: {}, disallowedTagsMode: "escape" });
}

function topicDTO(topic: TopicRow): BibleTopicDTO {
  // 与经文收藏列表同策略：个别条目解析失效（如译本数据变动）时跳过，不让整份清单失败
  const passages = topic.entries.flatMap<BibleTopicPassageDTO>((entry) => {
    try {
      const passage = bibleTopicEntryPassage(entry);
      return [{
        id: entry.id,
        bookCode: entry.bookCode,
        bookName: passage.bookName,
        startChapter: entry.startChapter,
        startVerse: entry.startVerse,
        endChapter: entry.endChapter,
        endVerse: entry.endVerse,
        reference: passage.reference
      }];
    } catch {
      return [];
    }
  });
  return {
    id: topic.id,
    name: topic.name,
    createdAt: topic.createdAt.toISOString(),
    updatedAt: topic.updatedAt.toISOString(),
    passages
  };
}

async function lockTopic(tx: Prisma.TransactionClient, id: number, accountId: number) {
  if (!Number.isInteger(id)) throw fail(404, "主题不存在");
  await tx.$queryRaw`SELECT id FROM bible_topics WHERE id = ${id} FOR UPDATE`;
  const topic = await tx.bibleTopic.findUnique({ where: { id }, include: entryInclude });
  if (!topic || topic.accountId !== accountId) throw fail(404, "主题不存在");
  return topic;
}

export function registerBibleTopicRoutes(app: FastifyInstance, deps: BibleRouteDependencies) {
  const { prisma, requireAuth, canWriteChannel, emitMessage, sendMessagePush, hydrateMessage } = deps;
  const preHandler = requireAuth;

  app.get("/api/bible/topics", { preHandler }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const accountId = (request as AuthedBibleRequest).auth.accountId;
    const topics = await prisma.bibleTopic.findMany({ where: { accountId }, include: entryInclude, orderBy: { updatedAt: "desc" } });
    return { success: true, topics: topics.map(topicDTO) };
  });

  app.post("/api/bible/topics", { preHandler }, async (request, reply) => {
    const parsed = z.object({ name: nameSchema }).strict().safeParse(request.body);
    if (!parsed.success) throw fail(400, "主题名称无效");
    const accountId = (request as AuthedBibleRequest).auth.accountId;
    const count = await prisma.bibleTopic.count({ where: { accountId } });
    if (count >= BIBLE_TOPIC_COUNT_MAX) throw fail(400, "主题数量已达上限，请先删除不再使用的主题");
    let topic;
    try {
      topic = await prisma.bibleTopic.create({ data: { accountId, name: parsed.data.name }, include: entryInclude });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw fail(409, "已有同名主题，请换个名称");
      throw error;
    }
    reply.header("Cache-Control", "private, no-store");
    return { success: true, topic: topicDTO(topic) };
  });

  app.patch<{ Params: { id: string } }>("/api/bible/topics/:id", { preHandler }, async (request) => {
    const parsed = z.object({ name: nameSchema }).strict().safeParse(request.body);
    if (!parsed.success) throw fail(400, "主题名称无效");
    const accountId = (request as AuthedBibleRequest).auth.accountId;
    const topic = await prisma.$transaction(async (tx) => {
      const row = await lockTopic(tx, Number(request.params.id), accountId);
      try {
        return await tx.bibleTopic.update({ where: { id: row.id }, data: { name: parsed.data.name }, include: entryInclude });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw fail(409, "已有同名主题，请换个名称");
        throw error;
      }
    });
    return { success: true, topic: topicDTO(topic) };
  });

  app.delete<{ Params: { id: string } }>("/api/bible/topics/:id", { preHandler }, async (request) => {
    const accountId = (request as AuthedBibleRequest).auth.accountId;
    const id = Number(request.params.id);
    if (Number.isInteger(id)) await prisma.bibleTopic.deleteMany({ where: { id, accountId } });
    return { success: true };
  });

  // 批量添加：直接解析整段引用串（支持中文书名、；/，分隔、节范围、书名继承）
  app.post<{ Params: { id: string } }>("/api/bible/topics/:id/passages", { preHandler }, async (request) => {
    const parsed = z.object({ reference: z.string().trim().min(1).max(BIBLE_TOPIC_REFERENCE_MAX) }).strict().safeParse(request.body);
    if (!parsed.success) throw fail(400, "引用内容无效");
    const accountId = (request as AuthedBibleRequest).auth.accountId;
    let input;
    try {
      input = parseBibleTopicPassages(parsed.data.reference, BIBLE_TOPIC_PASSAGE_MAX);
    } catch (error) {
      if (error instanceof Error && error.message === "passage limit exceeded") throw fail(400, `一次最多添加 ${BIBLE_TOPIC_PASSAGE_MAX} 段经文`);
      throw fail(400, "暂时识别不了这段引用，请检查经文章节号的写法");
    }
    const result = await prisma.$transaction(async (tx) => {
      const topic = await lockTopic(tx, Number(request.params.id), accountId);
      const base = topic.entries.reduce((max, entry) => Math.max(max, entry.sortOrder), 0);
      const inserted = await tx.bibleTopicEntry.createMany({
        data: input.map((passage, index) => ({
          topicId: topic.id,
          sortOrder: base + index + 1,
          bookCode: passage.bookCode,
          startChapter: passage.startChapter,
          startVerse: passage.startVerse,
          endChapter: passage.endChapter,
          endVerse: passage.endVerse
        })),
        skipDuplicates: true
      });
      const updated = await tx.bibleTopic.update({ where: { id: topic.id }, data: { updatedAt: new Date() }, include: entryInclude });
      return { topic: updated, added: inserted.count };
    });
    return { success: true, topic: topicDTO(result.topic), added: result.added, duplicates: input.length - result.added };
  });

  app.delete<{ Params: { id: string } }>("/api/bible/topics/:id/passages", { preHandler }, async (request) => {
    const parsed = z.object({ passageIds: z.array(z.number().int().positive()).min(1).max(BIBLE_TOPIC_PASSAGE_MAX) }).strict().safeParse(request.body);
    if (!parsed.success) throw fail(400, "移除请求无效");
    const accountId = (request as AuthedBibleRequest).auth.accountId;
    const topic = await prisma.$transaction(async (tx) => {
      const row = await lockTopic(tx, Number(request.params.id), accountId);
      await tx.bibleTopicEntry.deleteMany({ where: { topicId: row.id, id: { in: parsed.data.passageIds } } });
      return tx.bibleTopic.update({ where: { id: row.id }, data: { updatedAt: new Date() }, include: entryInclude });
    });
    return { success: true, topic: topicDTO(topic) };
  });

  // 转发主题到聊天室：服务端按已存条目生成自包含的经文主题卡片消息
  app.post<{ Params: { id: string } }>("/api/bible/topics/:id/share", { preHandler }, async (request) => {
    const parsed = z.object({ channelId: z.number().int().positive(), clientRequestId: z.string().uuid() }).strict().safeParse(request.body);
    if (!parsed.success) throw fail(400, "转发请求无效");
    const { accountId, actorId } = (request as AuthedBibleRequest).auth;
    const channel = await prisma.channel.findUnique({ where: { id: parsed.data.channelId }, select: { id: true, kind: true } });
    if (!channel || !["standard", "direct"].includes(channel.kind) || !await canWriteChannel(accountId, channel.id)) throw fail(403, "无权在该聊天室转发");
    const result = await prisma.$transaction(async (tx) => {
      const topic = await lockTopic(tx, Number(request.params.id), accountId);
      if (!topic.entries.length) throw fail(400, "主题还没有经文，请先添加");
      const existing = await tx.message.findUnique({ where: { senderActorId_clientRequestId: { senderActorId: actorId, clientRequestId: parsed.data.clientRequestId } } });
      if (existing) return { message: existing, created: false };
      const passages = topic.entries.map((entry) => {
        const passage = bibleTopicEntryPassage(entry);
        return {
          reference: passage.reference,
          text: passage.verses.map((verse) => `${verse.verse} ${verse.text}`).join("\n")
        };
      });
      const content = escapeTopicContentText(
        [`经文主题 · ${topic.name}`, ...passages.map((passage) => `${passage.reference}\n${passage.text}`)].join("\n\n")
      );
      const payload = {
        kind: "bible_topic",
        name: topic.name,
        translation: defaultBibleTranslationName(),
        passages
      };
      const message = await tx.message.create({ data: { channelId: channel.id, senderActorId: actorId, clientRequestId: parsed.data.clientRequestId, type: "text", content, payload } });
      return { message, created: true };
    });
    const payload = result.message.payload as { kind?: string } | null;
    if (result.message.channelId !== channel.id || result.message.type !== "text" || payload?.kind !== "bible_topic") throw fail(409, "该请求已用于另一条消息");
    const message = await hydrateMessage(result.message.id, accountId);
    if (!message) throw fail(404, "转发消息不存在");
    await emitMessage(result.message.id);
    if (result.created) void sendMessagePush(result.message.id, pushOriginFromHeaders(request.headers)).catch((error) => request.log.warn({ error, messageId: result.message.id }, "topic share push failed"));
    return { success: true, message };
  });
}
