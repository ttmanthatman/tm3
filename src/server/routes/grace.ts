import { Prisma, type Message, type PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { GRACE_IMAGE_LIMIT, GRACE_IMAGE_NAME, graceImages, graceImageFiles } from "../../shared/grace.js";
import { readGraceUpload } from "../services/graceUploads.js";
import { graceUpdateStoryText, prependGraceUpdateHistory } from "../services/graceUpdates.js";
import type { GraceSaveInput } from "../services/gracePersistence.js";
import type { MessageDTO } from "../../shared/types.js";
import { cleanSupportedMessageEffect } from "../../shared/messageEffects.js";
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
  requireMediaAuth: preHandlerHookHandler;
  uploadDirectory: string;
  canAccessChannel(accountId: number, channelId: number): Promise<boolean>;
  canWriteChannel(accountId: number, channelId: number): Promise<boolean>;
  saveGrace(input: GraceSaveInput, pushOrigin: string): Promise<{ id: number }>;
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
  const { prisma, requireAuth, canAccessChannel, canWriteChannel, saveGrace, hydrateMessage, deleteMessages, io, cleanText } = deps;

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

  app.post("/api/grace/prepare-image", { preHandler: requireAuth, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const upload = await readGraceUpload(request, reply);
    try {
      const { channelId } = z.object({ channelId: z.number().int().positive() }).parse(upload.body);
      if (!(await canWriteChannel((request as AuthedGraceRequest).auth.accountId, channelId))) return reply.code(403).send({ message: "无权在此频道发言" });
      if (upload.images.length !== 1) return reply.code(400).send({ message: "请选择一张照片" });
      reply.header("Cache-Control", "private, no-store");
      return { base64: (await upload.read(upload.images[0].fileName)).toString("base64"), contentType: "image/webp" };
    } finally { await upload.dispose(); }
  });

  app.get("/api/grace/:messageId/images/:fileName", { preHandler: deps.requireMediaAuth }, async (request, reply) => {
    const { messageId, fileName } = request.params as { messageId: string; fileName: string };
    if (!GRACE_IMAGE_NAME.test(fileName) || !/^\d+$/.test(messageId)) return reply.code(404).send({ message: "照片不存在" });
    const message = await prisma.message.findUnique({ where: { id: Number(messageId) } });
    if (!message || message.type !== "grace") return reply.code(404).send({ message: "照片不存在" });
    if (!(await canAccessChannel((request as AuthedGraceRequest).auth.accountId, message.channelId))) return reply.code(403).send({ message: "无权查看照片" });
    const source = await canonicalGraceMessage(message);
    if (!graceImageFiles(message.payload).includes(fileName) && !graceImageFiles(source.payload).includes(fileName)) return reply.code(404).send({ message: "照片不存在" });
    const file = path.join(deps.uploadDirectory, fileName);
    try { await fs.promises.access(file); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return reply.code(404).send({ message: "照片不存在" });
      throw error;
    }
    reply.header("Cache-Control", "private, no-store").header("X-Content-Type-Options", "nosniff").type("image/webp");
    return reply.send(fs.createReadStream(file));
  });

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
    const upload = await readGraceUpload(request, reply);
    let committed = false;
    try {
      const body = z
        .object({
          channelId: z.number().int().positive(),
          content: z.string().max(10000).optional(),
          voiceMessageId: z.number().int().positive().optional(),
          imageMessageId: z.number().int().positive().optional(),
          effect: z.string().max(40).optional()
        })
        .parse(upload.body);
      const channelId = body.channelId;
      if (!(await canWriteChannel(auth.accountId, channelId))) return reply.code(403).send({ success: false, message: "无权在此频道发言" });
      const content = cleanText(body.content);
      const hasContent = !!content.replace(/<[^>]*>/g, "").trim() || /<br\s*\/?>/i.test(content);
      if (!hasContent && !body.voiceMessageId) return reply.code(400).send({ success: false, message: "恩典内容不能为空" });
      if (upload.images.length + (body.imageMessageId ? 1 : 0) > GRACE_IMAGE_LIMIT) return reply.code(400).send({ message: "最多附上 9 张照片" });
      const payload = { ...cleanGracePayload(body), ...(upload.images.length ? { images: upload.images } : {}) };
      if (payload.voiceMessageId && !(await isValidGraceVoiceMessage(payload.voiceMessageId, channelId))) {
        return reply.code(400).send({ success: false, message: "语音消息无效" });
      }
      if (payload.imageMessageId && !(await isValidGraceImageMessage(payload.imageMessageId, channelId))) {
        return reply.code(400).send({ success: false, message: "附带照片无效" });
      }
      await upload.persist(deps.uploadDirectory);
      const message = await saveGrace({
        channelId, actorId: auth.actorId, content, payload: payload as unknown as Prisma.InputJsonObject,
        ...(!auth.isGuest ? { story: {
          accountId: auth.accountId, content,
          voiceMessageId: payload.voiceMessageId,
          imageMessageId: payload.imageMessageId,
          ...(upload.images.length ? { imageFileNames: upload.images.map((image) => image.fileName) } : {})
        } } : {})
      }, pushOrigin);
      committed = true;
      return { success: true, message: await hydrateMessage(message.id, auth.accountId) };
    } finally { await upload.dispose(committed); }
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
    const upload = await readGraceUpload(request, reply);
    let committed = false;
    try {
      const body = z.object({
        content: z.string().max(10000),
        imageMessageId: z.number().int().positive().nullable().optional(),
        retainedImages: z.array(z.string().regex(GRACE_IMAGE_NAME)).max(GRACE_IMAGE_LIMIT).optional(),
        expectedUpdateAt: z.string().nullable().optional()
      }).parse(upload.body);
      const message = await prisma.message.findUnique({ where: { id: messageId }, include: { sender: true } });
      if (!message || message.type !== "grace") return reply.code(404).send({ success: false, message: "恩典见证不存在" });
      if (!(await canAccessChannel(auth.accountId, message.channelId))) return reply.code(403).send({ success: false, message: "无权访问此恩典见证" });
      const source = await canonicalGraceMessage(message);
      if (!(await canWriteChannel(auth.accountId, source.channelId))) return reply.code(403).send({ success: false, message: "无权在此频道发言" });
      const sourceSender = source.id === message.id ? message.sender : await prisma.actor.findUnique({ where: { id: source.senderActorId } });
      if (sourceSender?.accountId !== auth.accountId && !auth.isAdmin) return reply.code(403).send({ success: false, message: "只有记录者可以更新此恩典见证" });
      const raw = gracePayloadRaw(source.payload);
      const content = cleanText(body.content);
      if (!raw.voiceMessageId && !content.replace(/<[^>]*>/g, "").trim() && !/<br\s*\/?>/i.test(content)) {
        return reply.code(400).send({ success: false, message: "恩典见证不能为空" });
      }
      if (body.expectedUpdateAt !== undefined && body.expectedUpdateAt !== (raw.latestUpdateAt || null)) {
        return reply.code(409).send({ success: false, message: "这张恩典卡片已被更新，请重新打开编辑" });
      }
      const existingImages = graceImages(raw);
      const retainedNames = body.retainedImages ?? existingImages.map((image) => image.fileName);
      if (new Set(retainedNames).size !== retainedNames.length || retainedNames.some((name) => !existingImages.some((image) => image.fileName === name))) {
        return reply.code(400).send({ success: false, message: "保留照片无效" });
      }
      const images = [...existingImages.filter((image) => retainedNames.includes(image.fileName)), ...upload.images];
      const newImageMessageId = body.imageMessageId === undefined ? Number(raw.imageMessageId || 0) : Number(body.imageMessageId || 0);
      if (images.length + (newImageMessageId > 0 ? 1 : 0) > GRACE_IMAGE_LIMIT) return reply.code(400).send({ success: false, message: "最多附上 9 张照片" });
      if (content === source.content && newImageMessageId === Number(raw.imageMessageId || 0) && images.map((image) => image.fileName).join() === existingImages.map((image) => image.fileName).join()) {
        return { success: true, message: await hydrateMessage(source.id, auth.accountId), unchanged: true };
      }
      if (newImageMessageId && !(await isValidGraceImageMessage(newImageMessageId, source.channelId))) {
        return reply.code(400).send({ success: false, message: "附带照片无效" });
      }
      const previousImageMessageId = Number(raw.imageMessageId || 0);
      const updates = prependGraceUpdateHistory(
        raw,
        source.content || "",
        typeof raw.latestUpdateAt === "string" ? raw.latestUpdateAt : source.createdAt.toISOString(),
        typeof raw.latestUpdateBy === "string" ? raw.latestUpdateBy : sourceSender?.username
      );
      const sourcePayload = {
        ...raw,
        kind: "grace",
        latestUpdateAt: new Date().toISOString(),
        latestUpdateBy: auth.username,
        imageMessageId: newImageMessageId > 0 ? newImageMessageId : null,
        images,
        updates
      };
      await upload.persist(deps.uploadDirectory);
      const updateMessage = await saveGrace({
        channelId: source.channelId, actorId: auth.actorId, content,
        payload: sourcePayload as unknown as Prisma.InputJsonObject,
        source: { id: source.id, content: source.content || "", payload: source.payload },
        ...(!auth.isGuest ? { story: {
          accountId: sourceSender?.accountId || auth.accountId,
          content: graceUpdateStoryText(source.content || "", content),
          ...(newImageMessageId && newImageMessageId !== previousImageMessageId ? { imageMessageId: newImageMessageId } : {}),
          ...(upload.images.length ? { imageFileNames: upload.images.map((image) => image.fileName) } : {})
        } } : {})
      }, pushOrigin);
      committed = true;
      const sourceDto = await hydrateMessage(source.id);
      if (sourceDto) io.to(`ch:${source.channelId}`).emit("message:updated", sourceDto);
      return { success: true, message: await hydrateMessage(updateMessage.id, auth.accountId) };
    } finally { await upload.dispose(committed); }

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
