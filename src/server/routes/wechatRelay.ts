import crypto from "node:crypto";
import type { Actor, Message, PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  DEFAULT_WECHAT_RELAY_TEMPLATES,
  renderWeChatRelayNotification,
  WECHAT_RELAY_TEMPLATE_KEYS,
  WECHAT_RELAY_TEMPLATE_VARIABLE_KEYS,
  type WeChatRelayMentionTarget,
  type WeChatRelayTemplates
} from "../../shared/wechatRelayNotifications.js";
import { APP_VERSION, RELEASE_NOTES } from "../../shared/release.js";
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

const templateLineSchema = z.string().trim().min(1).max(200)
  .refine((value) => !/[\r\n]/.test(value))
  .refine((value) => [...value.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)]
    .every((match) => WECHAT_RELAY_TEMPLATE_VARIABLE_KEYS.has(match[1])), "通知说法包含不支持的参数");
const templateListSchema = z.array(templateLineSchema).min(1).max(8);
const templateShape = Object.fromEntries(
  WECHAT_RELAY_TEMPLATE_KEYS.map((key) => [key, templateListSchema])
) as Record<(typeof WECHAT_RELAY_TEMPLATE_KEYS)[number], typeof templateListSchema>;
const templatesSchema = z.object(templateShape).strict();

function storedTemplates(value: unknown): WeChatRelayTemplates {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const legacyAttachment = templateListSchema.safeParse(record.attachment);
  return Object.fromEntries(WECHAT_RELAY_TEMPLATE_KEYS.map((key) => {
    const parsed = templateListSchema.safeParse(record[key]);
    if (parsed.success) return [key, parsed.data];
    if (["image", "file", "voice", "musicPlaylist"].includes(key) && legacyAttachment.success) return [key, legacyAttachment.data];
    return [key, DEFAULT_WECHAT_RELAY_TEMPLATES[key]];
  })) as WeChatRelayTemplates;
}

const userMappingsSchema = z.array(z.object({
  accountId: z.number().int().positive(),
  wechatName: z.string().trim().min(1).max(80).refine((value) => !/[\r\n]/.test(value))
}).strict()).max(200).superRefine((rows, context) => {
  const accountIds = new Set<number>();
  const wechatNames = new Set<string>();
  rows.forEach((row, index) => {
    const normalizedName = row.wechatName.toLocaleLowerCase("zh-CN");
    if (accountIds.has(row.accountId)) context.addIssue({ code: "custom", path: [index, "accountId"], message: "聊天室用户不能重复映射" });
    if (wechatNames.has(normalizedName)) context.addIssue({ code: "custom", path: [index, "wechatName"], message: "微信名必须一一对应，不能重复" });
    accountIds.add(row.accountId);
    wechatNames.add(normalizedName);
  });
});

const storedConfigSchema = z.object({
  enabled: z.boolean().default(false),
  channelId: z.number().int().positive().nullable().default(null),
  targetGroup: z.string().trim().max(80).default(""),
  startAfterId: z.number().int().nonnegative().default(0),
  pendingAction: actionSchema.nullable().default(null),
  templates: z.unknown().transform(storedTemplates).default(DEFAULT_WECHAT_RELAY_TEMPLATES),
  systemPrefix: z.string().trim().min(1).max(40).default("系统消息"),
  userMappings: userMappingsSchema.default([])
});

const updateConfigSchema = z.object({
  enabled: z.boolean(),
  channelId: z.number().int().positive().nullable(),
  targetGroup: z.string().trim().max(80),
  templates: templatesSchema,
  systemPrefix: z.string().trim().min(1).max(40).optional(),
  userMappings: userMappingsSchema.optional()
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

type RelayPrisma = Pick<PrismaClient, "setting" | "channel" | "message" | "account" | "pinnedItem">;

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
  templates: DEFAULT_WECHAT_RELAY_TEMPLATES,
  systemPrefix: "系统消息",
  userMappings: []
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

  async function relayUsers() {
    const accounts = await deps.prisma.account.findMany({
      where: { isGuest: false },
      include: { actor: true },
      orderBy: { id: "asc" }
    });
    return accounts.flatMap((account) => account.actor ? [{
      accountId: account.id,
      username: account.username,
      displayName: account.displayName,
      actor: account.actor
    }] : []);
  }

  async function mentionProfiles(config: StoredConfig) {
    const users = await relayUsers();
    const mappings = new Map(config.userMappings.map((mapping) => [mapping.accountId, mapping.wechatName]));
    return users.map((user) => ({ ...user, wechatName: mappings.get(user.accountId) }));
  }

  function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function mentionedProfiles(content: string, profiles: Awaited<ReturnType<typeof mentionProfiles>>) {
    const text = content.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, " ");
    return profiles.flatMap((profile) => {
      const names = [profile.displayName, profile.username].map((name) => name.trim()).filter(Boolean);
      const mentioned = names.some((name) => new RegExp(
        `(^|[\\s，。！？、,.!?:;；：])@${escapeRegExp(name)}(?=$|[\\s，。！？、,.!?:;；：])`, "u"
      ).test(text));
      return mentioned ? [{
        accountId: profile.accountId,
        displayName: profile.displayName,
        username: profile.username,
        wechatName: profile.wechatName
      } satisfies WeChatRelayMentionTarget] : [];
    });
  }

  function systemMessage(input: {
    id: number;
    channelId: number;
    content: string;
    createdAt: string;
    systemKind: "pinned" | "versionUpdate";
    title?: string;
    version?: string;
    changelog?: string;
  }) {
    return {
      id: input.id,
      channelId: input.channelId,
      sender: { id: 1, kind: "system" as const, username: "system", displayName: "系统" },
      content: input.content,
      type: "system" as const,
      payload: { systemKind: input.systemKind, title: input.title, version: input.version, changelog: input.changelog },
      createdAt: input.createdAt
    };
  }

  async function managedSystemEvents(config: StoredConfig) {
    if (!config.channelId) return [];
    const [channel, pinned] = await Promise.all([
      deps.prisma.channel.findUnique({ where: { id: config.channelId }, select: { name: true } }),
      deps.prisma.pinnedItem.findFirst({
        where: { channelId: config.channelId, active: true },
        orderBy: { updatedAt: "desc" },
        select: { id: true, version: true, title: true, content: true, updatedAt: true }
      })
    ]);
    if (!channel) return [];
    const now = new Date().toISOString();
    const changelog = RELEASE_NOTES.join("\n");
    const versionMessage = systemMessage({
      id: 1,
      channelId: config.channelId,
      content: "",
      createdAt: now,
      systemKind: "versionUpdate",
      version: APP_VERSION,
      changelog
    });
    const versionEvent = {
      slot: "version",
      key: `version:${APP_VERSION}`,
      message: {
        ...versionMessage,
        relayText: renderWeChatRelayNotification(versionMessage, config.templates, {
          channel: channel.name,
          group: config.targetGroup,
          systemPrefix: config.systemPrefix,
          version: APP_VERSION,
          changelog
        })
      }
    };
    const pinnedSlot = `pinned:${config.channelId}`;
    if (!pinned) return [versionEvent, { slot: pinnedSlot, key: "none", message: null }];
    const pinnedMessage = systemMessage({
      id: pinned.id,
      channelId: config.channelId,
      content: pinned.content || "",
      createdAt: pinned.updatedAt.toISOString(),
      systemKind: "pinned",
      title: pinned.title || "新的置顶消息"
    });
    return [versionEvent, {
      slot: pinnedSlot,
      key: `pinned:${pinned.id}:${pinned.version}:${pinned.updatedAt.getTime()}`,
      message: {
        ...pinnedMessage,
        relayText: renderWeChatRelayNotification(pinnedMessage, config.templates, {
          channel: channel.name,
          group: config.targetGroup,
          systemPrefix: config.systemPrefix,
          title: pinned.title || "新的置顶消息"
        })
      }
    }];
  }

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

  app.get("/api/admin/wechat-relay", { preHandler: deps.requireAdmin }, async () => {
    const [credential, config, users] = await Promise.all([credentialState(), loadConfig(), relayUsers()]);
    return {
      ...credential,
      nasAccessUrl: deps.nasAccessUrl,
      config,
      users: users.map(({ actor: _actor, ...user }) => user),
      agent: publicStatus(status)
    };
  });

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
    if (body.userMappings?.length) {
      const accounts = await deps.prisma.account.findMany({
        where: { id: { in: body.userMappings.map((mapping) => mapping.accountId) }, isGuest: false },
        select: { id: true }
      });
      if (accounts.length !== body.userMappings.length) {
        return reply.code(400).send({ success: false, message: "用户映射中包含不存在或不可转发的聊天室账号" });
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
      templates: body.templates,
      systemPrefix: body.systemPrefix ?? previous.systemPrefix,
      userMappings: body.userMappings ?? previous.userMappings
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

  app.get("/api/wechat-relay/agent/config", { preHandler: requireAgent }, async () => {
    const config = await loadConfig();
    return { config: { ...config, systemEvents: await managedSystemEvents(config) } };
  });

  app.get("/api/wechat-relay/agent/messages", { preHandler: requireAgent }, async (request) => {
    const query = z.object({
      after: z.coerce.number().int().nonnegative().default(0),
      limit: z.coerce.number().int().min(1).max(200).default(200)
    }).parse(request.query);
    const config = await loadConfig();
    if (!config.enabled || !config.channelId) return { messages: [] };
    const after = Math.max(query.after, config.startAfterId);
    const [messages, channel, profiles] = await Promise.all([
      deps.prisma.message.findMany({
        where: { channelId: config.channelId, id: { gt: after } },
        include: { sender: true },
        orderBy: { id: "asc" },
        take: query.limit
      }) as Promise<Array<Message & { sender: Actor }>>,
      deps.prisma.channel.findUnique({ where: { id: config.channelId }, select: { name: true } }),
      mentionProfiles(config)
    ]);
    const mappingByAccountId = new Map(profiles.map((profile) => [profile.accountId, profile]));
    return {
      messages: messages.map((message) => {
        const mentions = mentionedProfiles(message.content || "", profiles);
        const relayMessage = {
          id: message.id,
          type: message.type,
          content: message.content || "",
          payload: message.payload || undefined,
          fileName: message.fileName,
          fileSize: message.fileSize,
          createdAt: message.createdAt.toISOString(),
          sender: {
            id: message.sender.id,
            kind: message.sender.kind,
            username: message.sender.username,
            displayName: message.sender.displayName
          }
        };
        return {
          ...relayMessage,
          channelId: message.channelId,
          relayText: renderWeChatRelayNotification(relayMessage, config.templates as WeChatRelayTemplates, {
            channel: channel?.name || "聊天室",
            group: config.targetGroup,
            systemPrefix: config.systemPrefix,
            senderWechatName: message.sender.accountId ? mappingByAccountId.get(message.sender.accountId)?.wechatName : undefined,
            mentions
          }),
          relayMentions: mentions.flatMap((mention) => mention.wechatName ? [mention.wechatName] : [])
        };
      })
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
