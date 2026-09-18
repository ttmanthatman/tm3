import { Prisma, type Message, type MessageType, type PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { MessageDTO } from "../../shared/types.js";
import { cleanSupportedMessageEffect } from "../../shared/messageEffects.js";
import { prependPrayerUpdateHistory } from "../prayerUpdates.js";
import { pushOriginFromHeaders } from "../pushOrigin.js";

export type GraceAuthContext = {
  accountId: number;
  actorId: number;
  username: string;
  isAdmin: boolean;
  isGuest: boolean;
  canPinMessages: boolean;
};

type AuthedGraceRequest = FastifyRequest & { auth: GraceAuthContext };

export type GraceRouteDependencies = {
  prisma: PrismaClient;
  requireAuth: preHandlerHookHandler;
  canAccessChannel(accountId: number, channelId: number): Promise<boolean>;
  canWriteChannel(accountId: number, channelId: number): Promise<boolean>;
  createMessageFromActor(input: {
    channelId: number;
    actorId: number;
    content?: string;
    type?: MessageType;
    payload?: unknown;
    replyToId?: number | null;
    pushOrigin?: string;
  }): Promise<{ id: number }>;
  hydrateMessage(id: number, viewerAccountId?: number): Promise<MessageDTO | null>;
  deleteMessages(messages: Array<Pick<Message, "id" | "channelId" | "filePath">>): Promise<number>;
  io: { to(room: string): { emit(event: string, payload: unknown): unknown } };
  cleanText(input: unknown): string;
};

function cleanGracePayload(input: { voiceMessageId?: number; imageMessageId?: number; effect?: string }) {
  const effect = cleanSupportedMessageEffect(input.effect);
  return {
    kind: "grace" as const,
    ...(effect ? { effect } : {}),
    ...(Number.isInteger(input.voiceMessageId) && Number(input.voiceMessageId) > 0 ? { voiceMessageId: input.voiceMessageId } : {}),
    ...(Number.isInteger(input.imageMessageId) && Number(input.imageMessageId) > 0 ? { imageMessageId: input.imageMessageId } : {})
  };
}

export function registerGraceRoutes(app: FastifyInstance, deps: GraceRouteDependencies) {
  const { prisma, requireAuth, canAccessChannel, canWriteChannel, createMessageFromActor, hydrateMessage, deleteMessages, io, cleanText } = deps;

  function gracePayloadRaw(input: unknown) {
    return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  }

  function sourceGraceMessageId(input: unknown, fallback: number) {
    const sourceId = Number(gracePayloadRaw(input).sourceGraceMessageId || 0);
    return Number.isFinite(sourceId) && sourceId > 0 ? sourceId : fallback;
  }

  async function canonicalGraceMessage(message: Message) {
    const sourceId = sourceGraceMessageId(message.payload, message.id);
    if (sourceId === message.id) return message;
    return (await prisma.message.findFirst({ where: { id: sourceId, channelId: message.channelId, type: "grace" } })) || message;
  }

  async function isValidGraceVoiceMessage(voiceMessageId: number, channelId: number) {
    const source = await prisma.message.findFirst({
      where: { id: voiceMessageId, channelId, type: "file" },
      select: { id: true, payload: true }
    });
    const payload = source?.payload && typeof source.payload === "object" && !Array.isArray(source.payload) ? (source.payload as Record<string, unknown>) : null;
    return payload?.kind === "voice";
  }

  async function isValidGraceImageMessage(imageMessageId: number, channelId: number) {
    if (!Number.isInteger(imageMessageId) || imageMessageId <= 0) return false;
    const image = await prisma.message.findFirst({ where: { id: imageMessageId, channelId, type: "image" }, select: { id: true } });
    return !!image;
  }

  app.get("/api/grace/favorites", { preHandler: requireAuth }, async (request) => {
    const auth = (request as AuthedGraceRequest).auth;
    const rows = await prisma.message.findMany({
      where: {
        type: "grace",
        OR: [
          { senderActorId: auth.actorId },
          { favorites: { some: { accountId: auth.accountId } } }
        ]
      },
      include: {
        channel: { select: { id: true, name: true } },
        favorites: { where: { accountId: auth.accountId }, select: { id: true, createdAt: true } }
      },
      orderBy: { createdAt: "desc" },
      take: 200
    });
    const favorites = [];
    for (const row of rows) {
      if (sourceGraceMessageId(row.payload, row.id) !== row.id) continue;
      if (!(await canAccessChannel(auth.accountId, row.channelId))) continue;
      const message = await hydrateMessage(row.id, auth.accountId);
      if (!message) continue;
      const favorite = row.favorites[0];
      favorites.push({
        id: row.id,
        savedAt: (favorite?.createdAt || row.createdAt).toISOString(),
        own: row.senderActorId === auth.actorId,
        favorited: !!favorite,
        channel: row.channel,
        message
      });
    }
    return { success: true, favorites };
  });

  app.post("/api/grace", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedGraceRequest).auth;
    const pushOrigin = pushOriginFromHeaders(request.headers);
    const body = z
      .object({
        channelId: z.number().int().positive(),
        content: z.string().max(10000).optional(),
        voiceMessageId: z.number().int().positive().optional(),
        imageMessageId: z.number().int().positive().optional(),
        effect: z.string().max(40).optional()
      })
      .parse(request.body || {});
    const channelId = body.channelId;
    if (!(await canWriteChannel(auth.accountId, channelId))) return reply.code(403).send({ success: false, message: "无权在此频道发言" });
    const content = cleanText(body.content);
    const hasContent = !!content.replace(/<[^>]*>/g, "").trim() || /<br\s*\/?>/i.test(content);
    if (!hasContent && !body.voiceMessageId) return reply.code(400).send({ success: false, message: "恩典内容不能为空" });
    const payload = cleanGracePayload(body);
    if (payload.voiceMessageId && !(await isValidGraceVoiceMessage(payload.voiceMessageId, channelId))) {
      return reply.code(400).send({ success: false, message: "语音消息无效" });
    }
    if (payload.imageMessageId && !(await isValidGraceImageMessage(payload.imageMessageId, channelId))) {
      return reply.code(400).send({ success: false, message: "附带照片无效" });
    }
    const message = await createMessageFromActor({
      channelId,
      actorId: auth.actorId,
      content,
      type: "grace",
      payload,
      pushOrigin
    });
    return { success: true, message: await hydrateMessage(message.id, auth.accountId) };
  });

  app.post("/api/messages/:messageId/grateful", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedGraceRequest).auth;
    const messageId = Number((request.params as { messageId: string }).messageId);
    const message = await prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.type !== "grace") return reply.code(404).send({ success: false, message: "恩典见证不存在" });
    if (!(await canAccessChannel(auth.accountId, message.channelId))) return reply.code(403).send({ success: false, message: "无权访问此恩典见证" });
    const target = await canonicalGraceMessage(message);
    await prisma.prayerAction.create({ data: { messageId: target.id, accountId: auth.accountId } });
    const dto = await hydrateMessage(messageId, auth.accountId);
    if (dto) io.to(`ch:${message.channelId}`).emit("message:updated", dto);
    return { success: true, message: dto };
  });

  app.post("/api/messages/:messageId/grace-update", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedGraceRequest).auth;
    const pushOrigin = pushOriginFromHeaders(request.headers);
    const messageId = Number((request.params as { messageId: string }).messageId);
    const body = z.object({ content: z.string().max(10000), imageMessageId: z.number().nullable().optional() }).parse(request.body || {});
    const message = await prisma.message.findUnique({ where: { id: messageId }, include: { sender: true } });
    if (!message || message.type !== "grace") return reply.code(404).send({ success: false, message: "恩典见证不存在" });
    if (!(await canAccessChannel(auth.accountId, message.channelId))) return reply.code(403).send({ success: false, message: "无权访问此恩典见证" });
    const source = await canonicalGraceMessage(message);
    const sourceSender = source.id === message.id ? message.sender : await prisma.actor.findUnique({ where: { id: source.senderActorId } });
    if (sourceSender?.accountId !== auth.accountId && !auth.isAdmin) return reply.code(403).send({ success: false, message: "只有记录者可以更新此恩典见证" });
    const content = cleanText(body.content);
    if (!content.replace(/<[^>]*>/g, "").trim() && !/<br\s*\/?>/i.test(content)) {
      return reply.code(400).send({ success: false, message: "恩典见证不能为空" });
    }
    const raw = gracePayloadRaw(source.payload);
    const newImageMessageId = body.imageMessageId ? Number(body.imageMessageId) : 0;
    if (newImageMessageId && !(await isValidGraceImageMessage(newImageMessageId, source.channelId))) {
      return reply.code(400).send({ success: false, message: "附带照片无效" });
    }
    const previousImageMessageId = Number(raw.imageMessageId || 0);
    const updates = prependPrayerUpdateHistory(
      raw,
      source.content || "",
      typeof raw.latestUpdateAt === "string" ? raw.latestUpdateAt : source.createdAt.toISOString(),
      typeof raw.latestUpdateBy === "string" ? raw.latestUpdateBy : sourceSender?.username,
      Number.isInteger(previousImageMessageId) && previousImageMessageId > 0 ? previousImageMessageId : undefined
    );
    const sourcePayload = {
      ...raw,
      kind: "grace",
      latestUpdateAt: new Date().toISOString(),
      latestUpdateBy: auth.username,
      imageMessageId: newImageMessageId > 0 ? newImageMessageId : null,
      updates
    };
    await prisma.message.update({ where: { id: source.id }, data: { content, payload: sourcePayload as Prisma.InputJsonObject } });
    const sourceDto = await hydrateMessage(source.id);
    if (sourceDto) io.to(`ch:${source.channelId}`).emit("message:updated", sourceDto);
    const updateMessage = await createMessageFromActor({
      channelId: source.channelId,
      actorId: auth.actorId,
      content,
      type: "grace",
      payload: { ...sourcePayload, sourceGraceMessageId: source.id },
      pushOrigin
    });
    return { success: true, message: await hydrateMessage(updateMessage.id, auth.accountId) };
  });

  app.delete("/api/messages/:messageId/grace", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedGraceRequest).auth;
    const messageId = Number((request.params as { messageId: string }).messageId);
    const message = await prisma.message.findUnique({ where: { id: messageId }, include: { sender: true } });
    if (!message || message.type !== "grace") return reply.code(404).send({ success: false, message: "恩典见证不存在" });
    if (message.sender.accountId !== auth.accountId && !auth.isAdmin) return reply.code(403).send({ success: false, message: "只有记录者可以撤回此恩典见证" });
    return { success: true, deleted: await deleteMessages([{ id: message.id, channelId: message.channelId, filePath: message.filePath }]) };
  });
}
