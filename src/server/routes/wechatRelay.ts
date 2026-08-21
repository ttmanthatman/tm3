import crypto from "node:crypto";
import type { Actor, Message, PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

const SETTING_KEY = "wechatRelayConfig";
const ONLINE_WINDOW_MS = 30_000;

const actionSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string().uuid(), type: z.literal("calibrate"), targetGroup: z.string().trim().min(1).max(80), createdAt: z.string() }),
  z.object({ id: z.string().uuid(), type: z.literal("test"), targetGroup: z.string().trim().min(1).max(80), text: z.string().trim().min(1).max(2000), createdAt: z.string() })
]);

const storedConfigSchema = z.object({
  enabled: z.boolean().default(false),
  channelId: z.number().int().positive().nullable().default(null),
  targetGroup: z.string().trim().max(80).default(""),
  startAfterId: z.number().int().nonnegative().default(0),
  pendingAction: actionSchema.nullable().default(null)
});

const updateConfigSchema = z.object({
  enabled: z.boolean(),
  channelId: z.number().int().positive().nullable(),
  targetGroup: z.string().trim().max(80)
}).strict();

const heartbeatSchema = z.object({
  deviceName: z.string().trim().min(1).max(80),
  driverReady: z.boolean(),
  calibratedTarget: z.string().trim().max(80).nullable().optional(),
  queue: z.record(z.string(), z.number().int().nonnegative()).default({}),
  attention: z.number().int().nonnegative().default(0),
  lastError: z.string().trim().max(1000).nullable().optional()
}).strict();

const actionResultSchema = z.object({
  actionId: z.string().uuid(),
  success: z.boolean(),
  message: z.string().trim().min(1).max(1000)
}).strict();

type StoredConfig = z.infer<typeof storedConfigSchema>;
type AgentStatus = z.infer<typeof heartbeatSchema> & {
  lastSeenAt: string;
  lastAction?: { type: "calibrate" | "test"; success: boolean; message: string; completedAt: string };
};

type RelayPrisma = Pick<PrismaClient, "setting" | "channel" | "message">;

export type WeChatRelayRouteDependencies = {
  prisma: RelayPrisma;
  requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  agentToken: string;
};

const defaultConfig = (): StoredConfig => ({
  enabled: false,
  channelId: null,
  targetGroup: "",
  startAfterId: 0,
  pendingAction: null
});

function safeTokenEqual(actual: string, expected: string) {
  if (!actual || !expected) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function agentToken(request: FastifyRequest) {
  const authorization = request.headers.authorization || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
}

function publicStatus(status: AgentStatus | null) {
  if (!status) return { online: false, lastSeenAt: null };
  return {
    ...status,
    online: Date.now() - Date.parse(status.lastSeenAt) <= ONLINE_WINDOW_MS
  };
}

export function registerWeChatRelayRoutes(app: FastifyInstance, deps: WeChatRelayRouteDependencies) {
  let status: AgentStatus | null = null;

  async function loadConfig(): Promise<StoredConfig> {
    const row = await deps.prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    if (!row) return defaultConfig();
    try {
      return storedConfigSchema.parse(JSON.parse(row.value));
    } catch {
      return defaultConfig();
    }
  }

  async function saveConfig(config: StoredConfig) {
    const value = JSON.stringify(config);
    await deps.prisma.setting.upsert({
      where: { key: SETTING_KEY },
      update: { value },
      create: { key: SETTING_KEY, value }
    });
  }

  async function requireAgent(request: FastifyRequest, reply: FastifyReply) {
    if (!deps.agentToken) {
      return reply.code(503).send({ success: false, message: "微信转发代理尚未配置" });
    }
    if (!safeTokenEqual(agentToken(request), deps.agentToken)) {
      return reply.code(401).send({ success: false, message: "转发代理认证失败" });
    }
  }

  app.get("/api/admin/wechat-relay", { preHandler: deps.requireAdmin }, async () => ({
    configured: Boolean(deps.agentToken),
    config: await loadConfig(),
    agent: publicStatus(status)
  }));

  app.put("/api/admin/wechat-relay", { preHandler: deps.requireAdmin }, async (request, reply) => {
    const parsed = updateConfigSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ success: false, message: "微信转发设置无效" });
    const body = parsed.data;
    if (body.enabled && (!body.channelId || !body.targetGroup)) {
      return reply.code(400).send({ success: false, message: "启用前请选择来源频道并填写目标微信群" });
    }
    if (body.channelId) {
      const channel = await deps.prisma.channel.findUnique({ where: { id: body.channelId }, select: { id: true, kind: true } });
      if (!channel || channel.kind !== "standard") {
        return reply.code(400).send({ success: false, message: "只能选择正式聊天频道作为通知来源" });
      }
    }
    const previous = await loadConfig();
    let startAfterId = previous.startAfterId;
    if (body.channelId && (previous.channelId !== body.channelId || (!previous.enabled && body.enabled))) {
      const latest = await deps.prisma.message.aggregate({ where: { channelId: body.channelId }, _max: { id: true } });
      startAfterId = latest._max.id || 0;
    }
    const config: StoredConfig = {
      enabled: body.enabled,
      channelId: body.channelId,
      targetGroup: body.targetGroup,
      startAfterId,
      pendingAction: previous.pendingAction
    };
    await saveConfig(config);
    return { success: true, config, agent: publicStatus(status) };
  });

  app.post("/api/admin/wechat-relay/actions", { preHandler: deps.requireAdmin }, async (request, reply) => {
    const body = z.object({ type: z.enum(["calibrate", "test"]) }).strict().safeParse(request.body);
    if (!body.success) return reply.code(400).send({ success: false, message: "操作无效" });
    const config = await loadConfig();
    if (!config.targetGroup) return reply.code(400).send({ success: false, message: "请先填写并保存目标微信群" });
    if (config.pendingAction) return reply.code(409).send({ success: false, message: "上一项微信操作仍在等待执行" });
    if (!publicStatus(status).online) return reply.code(409).send({ success: false, message: "NAS 转发设备当前不在线" });
    if (body.data.type === "test" && !status?.driverReady) {
      return reply.code(409).send({ success: false, message: "请先打开目标微信群并完成绑定" });
    }
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    config.pendingAction = body.data.type === "calibrate"
      ? { id, type: "calibrate", targetGroup: config.targetGroup, createdAt }
      : {
          id,
          type: "test",
          targetGroup: config.targetGroup,
          text: `【聊天室微信转发实测】\n目标群：${config.targetGroup}\n时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}\n这是一条由聊天室管理入口发出的测试消息。`,
          createdAt
        };
    await saveConfig(config);
    return { success: true, action: config.pendingAction };
  });

  app.get("/api/wechat-relay/agent/config", { preHandler: requireAgent }, async () => ({ config: await loadConfig() }));

  app.get("/api/wechat-relay/agent/messages", { preHandler: requireAgent }, async (request) => {
    const query = z.object({
      after: z.coerce.number().int().nonnegative().default(0),
      limit: z.coerce.number().int().min(1).max(200).default(200)
    }).parse(request.query);
    const config = await loadConfig();
    if (!config.enabled || !config.channelId) return { messages: [] };
    const after = Math.max(query.after, config.startAfterId);
    const messages = await deps.prisma.message.findMany({
      where: { channelId: config.channelId, id: { gt: after } },
      include: { sender: true },
      orderBy: { id: "asc" },
      take: query.limit
    }) as Array<Message & { sender: Actor }>;
    return {
      messages: messages.map((message) => ({
        id: message.id,
        channelId: message.channelId,
        sender: {
          id: message.sender.id,
          kind: message.sender.kind,
          username: message.sender.username,
          displayName: message.sender.displayName
        },
        content: message.content || "",
        type: message.type,
        payload: message.payload || undefined,
        fileName: message.fileName,
        fileSize: message.fileSize,
        createdAt: message.createdAt.toISOString()
      }))
    };
  });

  app.post("/api/wechat-relay/agent/heartbeat", { preHandler: requireAgent }, async (request, reply) => {
    const parsed = heartbeatSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ success: false, message: "设备状态无效" });
    status = { ...parsed.data, lastSeenAt: new Date().toISOString(), lastAction: status?.lastAction };
    return { success: true };
  });

  app.post("/api/wechat-relay/agent/action-result", { preHandler: requireAgent }, async (request, reply) => {
    const parsed = actionResultSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ success: false, message: "操作结果无效" });
    const config = await loadConfig();
    if (!config.pendingAction || config.pendingAction.id !== parsed.data.actionId) {
      return reply.code(409).send({ success: false, message: "操作已经失效" });
    }
    const actionType = config.pendingAction.type;
    const targetGroup = config.pendingAction.targetGroup;
    config.pendingAction = null;
    await saveConfig(config);
    status = {
      ...(status || { deviceName: "NAS 微信", driverReady: false, queue: {}, attention: 0, lastSeenAt: new Date().toISOString() }),
      ...(actionType === "calibrate" && parsed.data.success ? { driverReady: true, calibratedTarget: targetGroup } : {}),
      lastSeenAt: new Date().toISOString(),
      lastAction: { type: actionType, success: parsed.data.success, message: parsed.data.message, completedAt: new Date().toISOString() }
    };
    return { success: true };
  });
}
