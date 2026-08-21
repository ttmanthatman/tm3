import crypto from "node:crypto";
import type { Actor, Message, PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  DEFAULT_WECHAT_RELAY_TEMPLATES,
  renderWeChatRelayNotification,
  type WeChatRelayTemplates
} from "../../shared/wechatRelayNotifications.js";
import {
  generateWeChatRelayToken,
  hashWeChatRelayToken,
  parseWeChatRelayCredential,
  verifyWeChatRelayToken
} from "../services/wechatRelayCredential.js";

const SETTING_KEY = "wechatRelayConfig";
const CREDENTIAL_SETTING_KEY = "wechatRelayAgentCredential";
const ONLINE_WINDOW_MS = 30_000;

const actionSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string().uuid(), type: z.literal("calibrate"), targetGroup: z.string().trim().min(1).max(80), createdAt: z.string() }),
  z.object({ id: z.string().uuid(), type: z.literal("test"), targetGroup: z.string().trim().min(1).max(80), text: z.string().trim().min(1).max(2000), createdAt: z.string() })
]);

const templateLineSchema = z.string().trim().min(1).max(100).refine((value) => !/[\r\n]/.test(value));
const templateListSchema = z.array(templateLineSchema).min(1).max(8);
const templatesSchema = z.object({
  message: templateListSchema,
  mention: templateListSchema,
  prayer: templateListSchema,
  prayerUpdate: templateListSchema,
  attachment: templateListSchema,
  other: templateListSchema
}).strict();

const storedConfigSchema = z.object({
  enabled: z.boolean().default(false),
  channelId: z.number().int().positive().nullable().default(null),
  targetGroup: z.string().trim().max(80).default(""),
  startAfterId: z.number().int().nonnegative().default(0),
  pendingAction: actionSchema.nullable().default(null),
  templates: templatesSchema.default(DEFAULT_WECHAT_RELAY_TEMPLATES)
});

const updateConfigSchema = z.object({
  enabled: z.boolean(),
  channelId: z.number().int().positive().nullable(),
  targetGroup: z.string().trim().max(80),
  templates: templatesSchema
}).strict();

const tokenSchema = z.string()
  .trim()
  .min(24)
  .max(256)
  .regex(/^[A-Za-z0-9._~+/=-]+$/);

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
  nasAccessUrl: string | null;
};

export function normalizeWeChatRelayNasAccessUrl(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("WECHAT_RELAY_NAS_ACCESS_URL must be a valid HTTP(S) URL");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("WECHAT_RELAY_NAS_ACCESS_URL must be an HTTP(S) URL without embedded credentials");
  }
  return url.toString();
}

const defaultConfig = (): StoredConfig => ({
  enabled: false,
  channelId: null,
  targetGroup: "",
  startAfterId: 0,
  pendingAction: null,
  templates: DEFAULT_WECHAT_RELAY_TEMPLATES
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

  async function loadCredential() {
    const row = await deps.prisma.setting.findUnique({ where: { key: CREDENTIAL_SETTING_KEY } });
    return row ? parseWeChatRelayCredential(row.value) : null;
  }

  async function saveCredential(token: string) {
    const value = JSON.stringify(hashWeChatRelayToken(token));
    await deps.prisma.setting.upsert({
      where: { key: CREDENTIAL_SETTING_KEY },
      update: { value },
      create: { key: CREDENTIAL_SETTING_KEY, value }
    });
    status = null;
  }

  async function credentialState() {
    const stored = await loadCredential();
    return {
      configured: Boolean(stored || deps.agentToken),
      tokenSource: stored ? "admin" as const : deps.agentToken ? "environment" as const : "none" as const
    };
  }

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
    const stored = await loadCredential();
    if (!stored && !deps.agentToken) {
      return reply.code(503).send({ success: false, message: "微信转发代理尚未配置" });
    }
    const actual = agentToken(request);
    const valid = stored ? verifyWeChatRelayToken(actual, stored) : safeTokenEqual(actual, deps.agentToken);
    if (!valid) {
      return reply.code(401).send({ success: false, message: "转发代理认证失败" });
    }
  }

  app.get("/api/admin/wechat-relay", { preHandler: deps.requireAdmin }, async () => ({
    ...(await credentialState()),
    nasAccessUrl: deps.nasAccessUrl,
    config: await loadConfig(),
    agent: publicStatus(status)
  }));

  app.put("/api/admin/wechat-relay/token", { preHandler: deps.requireAdmin }, async (request, reply) => {
    const parsed = z.object({ token: tokenSchema }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ success: false, message: "设备令牌至少 24 位，且不能包含空格" });
    await saveCredential(parsed.data.token);
    return { success: true, ...(await credentialState()) };
  });

  app.post("/api/admin/wechat-relay/token", { preHandler: deps.requireAdmin }, async () => {
    const token = generateWeChatRelayToken();
    await saveCredential(token);
    return { success: true, token, ...(await credentialState()) };
  });

  app.delete("/api/admin/wechat-relay/token", { preHandler: deps.requireAdmin }, async () => {
    await deps.prisma.setting.deleteMany({ where: { key: CREDENTIAL_SETTING_KEY } });
    status = null;
    return { success: true, ...(await credentialState()) };
  });

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
      pendingAction: previous.pendingAction,
      templates: body.templates
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
          text: "测试消息到了，微信通知连接正常",
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
        createdAt: message.createdAt.toISOString(),
        relayText: renderWeChatRelayNotification({
          id: message.id,
          type: message.type,
          content: message.content || "",
          payload: message.payload || undefined,
          sender: {
            id: message.sender.id,
            kind: message.sender.kind,
            username: message.sender.username,
            displayName: message.sender.displayName
          }
        }, config.templates as WeChatRelayTemplates)
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
