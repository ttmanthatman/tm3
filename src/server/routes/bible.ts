import { Prisma, type PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { BibleSessionPayloadDTO, MessageDTO } from "../../shared/types.js";
import { bibleCatalog } from "../bible/lookup.js";
import { pushOriginFromHeaders } from "../pushOrigin.js";

export type BibleAuthContext = {
  accountId: number;
  actorId: number;
};

export type AuthedBibleRequest = FastifyRequest & { auth: BibleAuthContext };

export type BibleRouteDependencies = {
  prisma: PrismaClient;
  requireAuth: preHandlerHookHandler;
  canWriteChannel(accountId: number, channelId: number): Promise<boolean>;
  emitMessage(messageId: number): Promise<unknown>;
  sendMessagePush(messageId: number, origin: string): Promise<void>;
  hydrateMessage(id: number, viewerAccountId?: number): Promise<MessageDTO | null>;
};

const shareBodySchema = z.object({
  channelId: z.number().int().positive(),
  description: z.string().trim().max(200).optional().default(""),
  orientation: z.enum(["columns", "rows"]).nullable().optional().default(null),
  receivingIndex: z.number().int().min(0).max(3).nullable().optional().default(null),
  panes: z
    .array(
      z.object({
        bookCode: z.string().trim().min(1).max(20),
        chapter: z.number().int().min(1).max(150),
        verseStart: z.number().int().min(1).max(200).nullable().optional(),
        verseEnd: z.number().int().min(1).max(200).nullable().optional()
      })
    )
    .min(1)
    .max(4)
});

export function registerBibleRoutes(app: FastifyInstance, deps: BibleRouteDependencies) {
  const { prisma, requireAuth, canWriteChannel, emitMessage, sendMessagePush, hydrateMessage } = deps;

  // 分享当前打开的阅读窗格布局到聊天频道（“打开的圣经”卡片）。
  // bookName 以服务端目录为准，客户端只能提供 bookCode/chapter/节范围。
  app.post("/api/bible/share", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedBibleRequest).auth;
    const parsed = shareBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ success: false, message: "分享内容格式无效" });
    const body = parsed.data;
    const catalog = bibleCatalog();
    const books = new Map([...catalog.oldTestament, ...catalog.newTestament].map((book) => [book.code, book]));
    const panes: BibleSessionPayloadDTO["panes"] = [];
    for (const pane of body.panes) {
      const book = books.get(pane.bookCode);
      if (!book || pane.chapter > book.chapterCount) {
        return reply.code(400).send({ success: false, message: "分享的经卷或章节不存在" });
      }
      const verseStart = pane.verseStart ?? null;
      const verseEnd = pane.verseEnd ?? verseStart;
      if (verseStart !== null && verseEnd !== null && verseEnd < verseStart) {
        return reply.code(400).send({ success: false, message: "分享的节范围无效" });
      }
      panes.push({ bookCode: book.code, bookName: book.name, chapter: pane.chapter, verseStart, verseEnd });
    }
    const channel = await prisma.channel.findUnique({ where: { id: body.channelId }, select: { kind: true } });
    if (!channel || (channel.kind !== "standard" && channel.kind !== "direct") || !(await canWriteChannel(auth.accountId, body.channelId))) {
      return reply.code(400).send({ success: false, message: "只能分享到你可以发言的聊天频道" });
    }
    const receivingIndex = body.receivingIndex !== null && body.receivingIndex < panes.length ? body.receivingIndex : null;
    const payload: BibleSessionPayloadDTO = {
      kind: "bible_session",
      translation: catalog.translation,
      orientation: body.orientation,
      receivingIndex,
      panes,
      ...(body.description ? { description: body.description } : {})
    };
    const summary = panes.map((pane, index) => `${String.fromCharCode(65 + index)}.${pane.bookName}${pane.chapter}章`).join(" ");
    const message = await prisma.message.create({
      data: {
        channelId: body.channelId,
        senderActorId: auth.actorId,
        content: body.description || `打开了 ${panes.length} 个圣经窗格：${summary}`,
        type: "bible_session",
        payload: payload as unknown as Prisma.InputJsonValue
      }
    });
    await emitMessage(message.id);
    void sendMessagePush(message.id, pushOriginFromHeaders(request.headers)).catch((error) =>
      request.log.warn({ error, messageId: message.id }, "bible session share push failed")
    );
    return { success: true, message: await hydrateMessage(message.id, auth.accountId) };
  });
}
