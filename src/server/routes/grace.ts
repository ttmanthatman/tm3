import type { MessageType, PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { ChannelDTO, MessageDTO } from "../../shared/types.js";
import { cleanSupportedMessageEffect } from "../../shared/messageEffects.js";
import { pushOriginFromHeaders } from "../pushOrigin.js";

export const GRACE_CHANNEL_NAME = "数算恩典";

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
  io: {
    to(room: string): { emit(event: string, payload: unknown): unknown };
    emit(event: string, payload: unknown): unknown;
  };
  canAccessChannel(accountId: number, channelId: number): Promise<boolean>;
  canWriteChannel(accountId: number, channelId: number): Promise<boolean>;
  channelDto(channelId: number, viewer?: Pick<GraceAuthContext, "accountId" | "isAdmin" | "canPinMessages">): Promise<ChannelDTO | null>;
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
  joinAccountChannel(accountId: number, channelId: number): void;
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
  const { prisma, requireAuth, io, canAccessChannel, canWriteChannel, channelDto, createMessageFromActor, hydrateMessage, joinAccountChannel, cleanText } = deps;
  let graceChannelIdCache: number | null = null;

  function findGraceChannel() {
    return prisma.channel.findFirst({ where: { name: GRACE_CHANNEL_NAME, kind: "standard" }, select: { id: true } });
  }

  async function ensureGraceChannel(): Promise<number> {
    if (graceChannelIdCache) return graceChannelIdCache;
    const existing = await findGraceChannel();
    if (existing) {
      graceChannelIdCache = existing.id;
      return existing.id;
    }
    try {
      const channel = await prisma.channel.create({
        data: { name: GRACE_CHANNEL_NAME, description: "数算恩典，彼此见证", icon: "", isPrivate: false },
        select: { id: true }
      });
      const accounts = await prisma.account.findMany({ select: { id: true } });
      await prisma.channelMember.createMany({
        data: accounts.map((account) => ({ accountId: account.id, channelId: channel.id, role: "member" })),
        skipDuplicates: true
      });
      for (const account of accounts) joinAccountChannel(account.id, channel.id);
      const dto = await channelDto(channel.id);
      io.emit("channel:updated", { action: "created", channel: dto });
      graceChannelIdCache = channel.id;
      return channel.id;
    } catch (error) {
      // 并发首建时只有一个创建能成功，失败后重新查找赢家创建的频道。
      const retry = await findGraceChannel();
      if (retry) {
        graceChannelIdCache = retry.id;
        return retry.id;
      }
      throw error;
    }
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

  app.get("/api/grace/channel", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedGraceRequest).auth;
    if (auth.isGuest) return reply.code(403).send({ success: false, message: "来访者不能访问恩典频道" });
    let channelId = await ensureGraceChannel();
    if (!(await canAccessChannel(auth.accountId, channelId))) return reply.code(403).send({ success: false, message: "无权访问恩典频道" });
    let dto = await channelDto(channelId, auth);
    if (!dto) {
      graceChannelIdCache = null;
      channelId = await ensureGraceChannel();
      dto = await channelDto(channelId, auth);
    }
    if (!dto) return reply.code(404).send({ success: false, message: "恩典频道不存在" });
    return { success: true, channel: dto };
  });

  app.post("/api/grace", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedGraceRequest).auth;
    const pushOrigin = pushOriginFromHeaders(request.headers);
    const body = z
      .object({
        content: z.string().max(10000).optional(),
        voiceMessageId: z.number().int().positive().optional(),
        imageMessageId: z.number().int().positive().optional(),
        effect: z.string().max(40).optional()
      })
      .parse(request.body || {});
    const channelId = await ensureGraceChannel();
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
