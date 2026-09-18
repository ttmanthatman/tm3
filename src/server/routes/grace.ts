import type { MessageType, PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { MessageDTO } from "../../shared/types.js";
import { cleanSupportedMessageEffect } from "../../shared/messageEffects.js";
import { pushOriginFromHeaders } from "../pushOrigin.js";

export type GraceAuthContext = {
  accountId: number;
  actorId: number;
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
  const { prisma, requireAuth, canAccessChannel, canWriteChannel, createMessageFromActor, hydrateMessage, cleanText } = deps;

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
}
