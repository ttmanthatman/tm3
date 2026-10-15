import { aiConversationSettingKey } from "../multichar/mode.js";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { DEFAULT_AI_CONVERSATION, type AiConversationConfig } from "../../shared/aiConversation.js";
import { AI_PROVIDERS, type AiProvider } from "../../shared/aiProviders.js";
import { virtualCharacterVisibleInChannel } from "../channelMembership.js";
import { createConversationController } from "../multichar/conversation.js";
import { createAiClient } from "../multichar/ai.js";
import type { MulticharDeps } from "../multichar/types.js";

export const conversationSchema = z.object({
  enabled: z.boolean(), characterIds: z.array(z.number().int().positive()).max(10),
  topic: z.string().trim().max(2000), maxMessages: z.number().int().min(1).max(500),
  maxContextChars: z.number().int().min(1000).max(5000000),
  maxDurationSeconds: z.number().int().min(10).max(14400),
  contextMessages: z.number().int().min(1).max(100), intervalSeconds: z.number().int().min(1).max(300)
}).strict();
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

export function registerAiConversationRoutes(app: FastifyInstance, deps: MulticharDeps & {
  requireAuth: preHandlerHookHandler;
  canAccessChannel(accountId: number, channelId: number): Promise<boolean>;
}) {
  const prisma: PrismaClient = deps.prisma;
  const ai = createAiClient(deps);
  const starters = new Map<number, number>();
  const commands = new Map<number, Promise<unknown>>();
  async function serialized<T>(id: number, work: () => Promise<T>): Promise<T> {
    const previous = commands.get(id) || Promise.resolve();
    const next = previous.then(work, work);
    commands.set(id, next);
    try { return await next; } finally { if (commands.get(id) === next) commands.delete(id); }
  }
  async function canControl(accountId: number, channelId: number) {
    const [account, member] = await Promise.all([
      prisma.account.findUnique({ where: { id: accountId }, select: { role: true, isGuest: true } }),
      prisma.channelMember.findUnique({ where: { channelId_accountId: { channelId, accountId } } })
    ]);
    return !!account && !account.isGuest && (account.role === "admin" || member?.role === "owner");
  }
  async function characters(channelId: number) {
    const channel = await prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel || !["standard", "direct"].includes(channel.kind)) throw new Error("频道不支持 AI 自主对话");
    const rows = await prisma.virtualCharacter.findMany({ where: { enabled: true }, include: { actor: true }, orderBy: { id: "asc" } });
    return rows.filter((row) => row.actor.status === "active" && virtualCharacterVisibleInChannel(channel, { username: row.actor.username, config: row.config }));
  }
  const controller = createConversationController({
    prepare: async (channelId, characterId, config) => {
      const starter = starters.get(channelId);
      if (!starter || !await deps.canAccessChannel(starter, channelId) || !await canControl(starter, channelId)) throw new Error("发起者无权控制频道");
      const candidates = await characters(channelId);
      if (config.characterIds.some((id) => !candidates.some((row) => row.id === id))) throw new Error("角色已移出频道或停用");
      const character = candidates.find((row) => row.id === characterId)!;
      const stored = object(character.config); const generation = object(stored.generation); const memory = object(stored.manualMemory);
      const rows = await prisma.message.findMany({ where: { channelId, type: "text" }, include: { sender: true }, orderBy: { id: "desc" }, take: config.contextMessages });
      const system = `你是${character.actor.displayName}。${String(object(stored.profile).persona || "自然参与讨论")}\n记忆：${[memory.shortTerm, memory.midTerm, memory.longTerm].filter(Boolean).join("\n")}\n和${candidates.filter((row) => config.characterIds.includes(row.id)).map((row) => row.actor.displayName).join("、")}自主对话。回应上一位并推进话题，只输出你自己的发言，不代替别人发言。`;
      return { actorId: character.actorId, model: typeof generation.model === "string" ? generation.model : undefined,
        provider: typeof generation.provider === "string" && Object.hasOwn(AI_PROVIDERS, generation.provider) ? generation.provider as AiProvider : undefined,
        thinkingEnabled: !!generation.thinkingEnabled,
        messages: [{ role: "system", content: system }, { role: "user", content: `主题：${config.topic || "自由交流，请主动开始一个话题"}\n频道最近对话：\n${rows.reverse().map((row) => `${row.sender.displayName}：${row.content}`).join("\n")}\n现在轮到你发言。` }]
      };
    },
    generate: (turn, signal) => ai.callLlm(turn.messages, { model: turn.model, provider: turn.provider, thinkingEnabled: turn.thinkingEnabled, signal, maxTokens: 1024 }),
    publish: (channelId, actorId, content) => deps.createMessageFromActor({ channelId, actorId, content, type: "text", payload: { aiConversation: true }, skipEngineEvent: true, skipPush: true })
  });
  const key = aiConversationSettingKey;
  async function configuration(id: number): Promise<AiConversationConfig> {
    const row = await prisma.setting.findUnique({ where: { key: key(id) } });
    try { return conversationSchema.parse(row ? JSON.parse(row.value) : DEFAULT_AI_CONVERSATION); }
    catch { return structuredClone(DEFAULT_AI_CONVERSATION); }
  }
  app.get("/api/channels/:id/ai-conversation", { preHandler: deps.requireAuth }, async (request, reply) => {
    const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id);
    const auth = (request as typeof request & { auth: { accountId: number } }).auth;
    if (!await deps.canAccessChannel(auth.accountId, id)) return reply.code(403).send({ message: "无权访问频道" });
    const channel = await prisma.channel.findUnique({ where: { id } });
    if (!channel || !["standard", "direct"].includes(channel.kind)) return reply.code(400).send({ message: "频道不支持 AI 自主对话" });
    const available = await characters(id);
    return { config: await configuration(id), status: controller.status(id), canControl: await canControl(auth.accountId, id), characters: available.map((row) => ({ id: row.id, displayName: row.actor.displayName })) };
  });
  app.post("/api/channels/:id/ai-conversation", { preHandler: deps.requireAuth }, async (request, reply) => {
    const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id);
    const auth = (request as typeof request & { auth: { accountId: number } }).auth;
    if (!await deps.canAccessChannel(auth.accountId, id) || !await canControl(auth.accountId, id)) return reply.code(403).send({ message: "只有频道创建者或管理员可以控制 AI 对话" });
    return serialized(id, async () => {
    const body = z.object({ action: z.enum(["save", "start", "pause", "resume", "stop"]), config: conversationSchema.optional() }).strict().parse(request.body);
    if (body.action === "save" || body.action === "start") {
      const config = body.config || await configuration(id);
      const available = await characters(id);
      if (config.characterIds.some((characterId) => !available.some((row) => row.id === characterId)) || new Set(config.characterIds).size !== config.characterIds.length) return reply.code(400).send({ message: "请选择频道内启用的角色，不能重复" });
      if (config.enabled && config.characterIds.length < 2) return reply.code(400).send({ message: "自主对话至少需要两个角色，请先在频道成员中邀请" });
      if (body.action === "start" && !config.enabled) return reply.code(400).send({ message: "请先启用 AI 自主对话" });
      if (["running", "paused"].includes(controller.status(id).state)) return reply.code(409).send({ message: "请先终止当前对话再修改配置或重新开始" });
      await prisma.setting.upsert({ where: { key: key(id) }, update: { value: JSON.stringify(config) }, create: { key: key(id), value: JSON.stringify(config) } });
      if (body.action === "start") { starters.set(id, auth.accountId); await controller.start(id, config); }
    } else await controller.control(id, body.action);
    return { config: await configuration(id), status: controller.status(id) };
    });
  });
  app.addHook("onClose", async () => { await controller.stopAll(); });
  return { ...controller,
    startForAccount: async (accountId: number, channelId: number, characterIds: number[]) => serialized(channelId, async () => {
      if (!await deps.canAccessChannel(accountId, channelId) || !await canControl(accountId, channelId)) throw new Error("无权控制此频道");
      const available = await characters(channelId);
      if (characterIds.length < 2 || new Set(characterIds).size !== characterIds.length || characterIds.some((id) => !available.some((row) => row.id === id))) throw new Error("请邀请并选择至少两个频道角色");
      if (["running", "paused"].includes(controller.status(channelId).state)) throw new Error("请先终止当前对话");
      const config = { ...await configuration(channelId), enabled: true, characterIds };
      await prisma.setting.upsert({ where: { key: key(channelId) }, update: { value: JSON.stringify(config) }, create: { key: key(channelId), value: JSON.stringify(config) } });
      starters.set(channelId, accountId); await controller.start(channelId, config);
    })
  };
}
