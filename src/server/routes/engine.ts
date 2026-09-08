import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Message, PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { MessageDTO } from "../../shared/types.js";
import { compressImageFile, IMAGE_EXTENSIONS, validateStoredImage } from "../imageProcessing.js";
import { AVATAR_DIR, safeUnlink } from "../storageDirs.js";

const ENGINE_API_TOKEN = process.env.ENGINE_API_TOKEN || "";

export type EngineRouteDependencies = {
  prisma: PrismaClient;
  requireAdmin: preHandlerHookHandler;
  io: { to(room: string): { emit(event: string, payload: unknown): unknown } };
  cleanText(input: unknown): string;
  createMessageFromActor(input: {
    channelId: number;
    actorId: number;
    content: string;
    type: "text";
    replyToId: number | null;
  }): Promise<Pick<Message, "id">>;
  hydrateMessage(id: number, viewerAccountId?: number): Promise<MessageDTO | null>;
  createEngineEvent(
    kind: "message_created" | "idle_tick" | "manual_test" | "active_topic_due",
    payload: unknown,
    channelId?: number,
    messageId?: number,
    characterId?: number
  ): Promise<unknown>;
};

export function defaultVirtualCharacterConfig(displayName: string) {
  return {
    profile: { name: displayName, persona: "", speakingStyle: "像微信群里的真人，简短自然" },
    channels: [],
    manualMemory: { shortTerm: "", midTerm: "", longTerm: "" },
    generation: { model: "", thinkingEnabled: false },
    replyPolicy: { mode: "external_engine_decides", allowSkip: true, allowMultipleMessages: true },
    proactivePolicy: { enabled: false, idleMinutes: 30 },
    typing: { show: true, minMs: 800, maxMs: 8000 },
    memory: { rememberUsers: true, maxItemsPerUser: 50 },
    modelHints: { provider: "deepseek", compatibleEndpoint: "/chat/completions", preferredModels: ["deepseek-v4-flash", "deepseek-v4-pro"] },
    multichar: {
      bio: { basics: { name: displayName, identity: "" } },
      emotionBaseline: "平静中性",
      modelHints: {}
    }
  };
}

function checkEngineAuth(request: FastifyRequest) {
  if (!ENGINE_API_TOKEN) return false;
  const token = request.headers.authorization?.startsWith("Bearer ") ? request.headers.authorization.slice(7) : request.headers["x-engine-token"];
  return token === ENGINE_API_TOKEN;
}

export function registerEngineRoutes(app: FastifyInstance, deps: EngineRouteDependencies) {
  const { prisma, requireAdmin, io, cleanText, createMessageFromActor, hydrateMessage, createEngineEvent } = deps;

  async function handleEngineAction(actionType: string, payload: unknown, eventId?: number) {
    const data = payload as any;
    if (actionType === "skip") return { skipped: true };
    if (actionType === "typing_start" || actionType === "typing_stop") {
      const channelId = Number(data.channelId);
      const character = await prisma.virtualCharacter.findUnique({ where: { id: Number(data.characterId) }, include: { actor: true } });
      if (!channelId || !character) throw new Error("invalid typing action");
      io.to(`ch:${channelId}`).emit("message:typing", {
        channelId,
        actor: { id: character.actor.id, username: character.actor.username, displayName: character.actor.displayName, kind: "virtual" },
        state: actionType === "typing_start" ? "start" : "stop"
      });
      return { typing: actionType };
    }
    if (actionType === "send_message") {
      const channelId = Number(data.channelId);
      const character = await prisma.virtualCharacter.findUnique({ where: { id: Number(data.characterId) }, include: { actor: true } });
      if (!channelId || !character?.enabled) throw new Error("invalid send action");
      const messages = Array.isArray(data.messages) ? data.messages : [{ content: data.content }];
      const created: MessageDTO[] = [];
      for (const msg of messages.slice(0, 6)) {
        const content = cleanText(msg.content);
        if (!content) continue;
        const row = await createMessageFromActor({ channelId, actorId: character.actorId, content, type: "text", replyToId: Number(msg.replyToId) || null });
        const dto = await hydrateMessage(row.id);
        if (dto) created.push(dto);
      }
      return { sent: created.map((m) => m.id) };
    }
    if (actionType === "remember_user") {
      const characterId = Number(data.characterId);
      const subjectType = String(data.subjectType || "account").slice(0, 32);
      const subjectId = String(data.subjectId || "").slice(0, 80);
      const content = String(data.content || "").slice(0, 2000);
      if (!characterId || !subjectId || !content) throw new Error("invalid memory action");
      const memory = await prisma.characterMemory.create({ data: { characterId, subjectType, subjectId, content, confidence: Number(data.confidence || 1) } });
      return { memoryId: memory.id };
    }
    if (actionType === "schedule_topic") {
      const channelId = Number(data.channelId);
      await createEngineEvent("active_topic_due", { topic: data.topic || "", scheduledBy: data.characterId || null }, channelId, undefined, Number(data.characterId) || undefined);
      return { scheduled: true };
    }
    return { ok: true, eventId };
  }

  app.get("/api/virtual-characters", { preHandler: requireAdmin }, async () => {
    const rows = await prisma.virtualCharacter.findMany({ include: { actor: true, memories: { take: 20, orderBy: { updatedAt: "desc" } } }, orderBy: { id: "asc" } });
    return { characters: rows };
  });

  app.post("/api/virtual-characters", { preHandler: requireAdmin }, async (request, reply) => {
    const body = z
      .object({
        username: z.string().regex(/^[a-zA-Z0-9_.-]{2,40}$/),
        displayName: z.string().min(1).max(80),
        enabled: z.boolean().default(true),
        config: z.unknown().optional(),
        engineBinding: z.unknown().optional()
      })
      .parse(request.body);
    try {
      const character = await prisma.virtualCharacter.create({
        data: {
          enabled: body.enabled,
          config: (body.config as object) || defaultVirtualCharacterConfig(body.displayName),
          engineBinding: (body.engineBinding as object) || {},
          actor: { create: { kind: "virtual", username: body.username, displayName: body.displayName } }
        },
        include: { actor: true }
      });
      return { success: true, character };
    } catch {
      return reply.code(409).send({ success: false, message: "角色用户名已存在" });
    }
  });

  app.put("/api/virtual-characters/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = z.object({ displayName: z.string().min(1).max(80).optional(), enabled: z.boolean().optional(), config: z.unknown().optional(), engineBinding: z.unknown().optional() }).parse(request.body);
    const current = await prisma.virtualCharacter.findUnique({ where: { id }, include: { actor: true } });
    if (!current) return reply.code(404).send({ success: false, message: "角色不存在" });
    const updated = await prisma.virtualCharacter.update({
      where: { id },
      data: {
        enabled: body.enabled,
        config: body.config as object | undefined,
        engineBinding: body.engineBinding as object | undefined,
        actor: body.displayName ? { update: { displayName: body.displayName } } : undefined
      },
      include: { actor: true }
    });
    return { success: true, character: updated };
  });

  app.post("/api/virtual-characters/:id/avatar", { preHandler: requireAdmin }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const character = await prisma.virtualCharacter.findUnique({ where: { id }, include: { actor: true } });
    if (!character) return reply.code(404).send({ success: false, message: "角色不存在" });
    const file = await request.file();
    if (!file) return reply.code(400).send({ success: false, message: "缺少头像图片" });
    const ext = path.extname(file.filename).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext) || !file.mimetype.startsWith("image/")) return reply.code(400).send({ success: false, message: "只支持图片头像" });
    const safeName = `${crypto.randomUUID()}${ext}`;
    const outPath = path.join(AVATAR_DIR, safeName);
    await new Promise<void>((resolve, reject) => {
      const stream = fs.createWriteStream(outPath);
      file.file.pipe(stream);
      file.file.on("error", reject);
      stream.on("finish", resolve);
      stream.on("error", reject);
    });
    if (!(await validateStoredImage(outPath))) {
      safeUnlink("avatar", safeName);
      return reply.code(400).send({ success: false, message: "头像内容无效或尺寸过大" });
    }
    let avatarPath = safeName;
    const compressed = await compressImageFile(outPath, AVATAR_DIR, { maxDimension: 256 });
    if (compressed) {
      fs.unlinkSync(outPath);
      avatarPath = compressed.fileName;
    }
    const actor = await prisma.actor.update({ where: { id: character.actorId }, data: { avatarPath } });
    return { success: true, character: { ...character, actor } };
  });

  app.delete("/api/virtual-characters/:id", { preHandler: requireAdmin }, async (request) => {
    const id = Number((request.params as { id: string }).id);
    await prisma.virtualCharacter.delete({ where: { id } });
    return { success: true };
  });

  app.post("/api/virtual-characters/:id/test-event", { preHandler: requireAdmin }, async (request) => {
    const id = Number((request.params as { id: string }).id);
    const body = z.object({ channelId: z.number(), prompt: z.string().default("手动测试") }).parse(request.body);
    await createEngineEvent("manual_test", { prompt: body.prompt }, body.channelId, undefined, id);
    return { success: true };
  });

  app.get("/api/engine/v1/events", async (request, reply) => {
    if (!checkEngineAuth(request)) return reply.code(401).send({ success: false, message: "engine token invalid" });
    const after = Number((request.query as { after?: string }).after || 0);
    const events = await prisma.engineEvent.findMany({ where: { id: { gt: after } }, orderBy: { id: "asc" }, take: 100 });
    return { events };
  });

  app.post("/api/engine/v1/actions", async (request, reply) => {
    if (!checkEngineAuth(request)) return reply.code(401).send({ success: false, message: "engine token invalid" });
    const body = z
      .object({
        eventId: z.number().optional(),
        event_id: z.number().optional(),
        idempotencyKey: z.string().min(8).max(120).optional(),
        idempotency_key: z.string().min(8).max(120).optional(),
        actionType: z.enum(["skip", "typing_start", "typing_stop", "send_message", "remember_user", "schedule_topic"]).optional(),
        action_type: z.enum(["skip", "typing_start", "typing_stop", "send_message", "remember_user", "schedule_topic"]).optional(),
        action: z.enum(["skip", "typing_start", "typing_stop", "send_message", "remember_user", "schedule_topic"]).optional(),
        characterId: z.number().optional(),
        character_id: z.number().optional(),
        channelId: z.number().optional(),
        channel_id: z.number().optional(),
        payload: z.unknown().optional()
      })
      .parse(request.body);

    const idempotencyKey = body.idempotencyKey || body.idempotency_key;
    const actionType = body.actionType || body.action_type || body.action;
    if (!idempotencyKey || !actionType) return reply.code(400).send({ success: false, message: "idempotency_key and action are required" });

    const rawPayload = body.payload && typeof body.payload === "object" && !Array.isArray(body.payload) ? (body.payload as Record<string, unknown>) : {};
    const payload = {
      ...rawPayload,
      characterId: rawPayload.characterId || rawPayload.character_id || body.characterId || body.character_id,
      channelId: rawPayload.channelId || rawPayload.channel_id || body.channelId || body.channel_id
    };
    const eventId = body.eventId || body.event_id;

    const existing = await prisma.engineAction.findUnique({ where: { idempotencyKey } });
    if (existing) return { success: true, duplicate: true, result: existing.result };
    const result = await handleEngineAction(actionType, payload, eventId);
    await prisma.engineAction.create({
      data: {
        eventId: eventId || null,
        idempotencyKey,
        actionType,
        payload,
        result: result as object
      }
    });
    return { success: true, result };
  });
}
