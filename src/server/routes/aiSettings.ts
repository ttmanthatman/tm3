import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Prisma, type Actor, type Message, type PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { AiRoleDTO, AiSettingsDTO, MessageDTO } from "../../shared/types.js";
import {
  AI_RELATED_VERSES_KIND,
  AI_ROLE_USERNAMES,
  DEFAULT_AI_PROMPT_COMMAND,
  DEFAULT_AI_SETTINGS,
  DEFAULT_QUESTION_ASSISTANT_CONTEXT_TURNS,
  DEFAULT_QUESTION_ASSISTANT_CONTEXT_WINDOW_MINUTES,
  DEFAULT_QUESTION_ASSISTANT_JUDGE_PROMPT,
  DEFAULT_QUESTION_ASSISTANT_PROMPT,
  DEFAULT_WHY_ASSISTANT_PROMPT,
  QUESTION_ASSISTANT_NAME,
  QUESTION_ASSISTANT_USERNAME,
  WHY_ASSISTANT_NAME,
  WHY_ASSISTANT_USERNAME,
  aiConfigurationMessage,
  callDeepSeekRelatedVerses,
  clampInteger,
  cleanAiError,
  type AiSettingsStore
} from "../aiSettings.js";
import { compressImageFile, IMAGE_EXTENSIONS, validateStoredImage } from "../imageProcessing.js";
import { AVATAR_DIR, safeUnlink } from "../storageDirs.js";
import { plainTextFromHtml } from "../textUtils.js";

type AiSettingsAuthContext = {
  accountId: number;
  isAdmin: boolean;
};

type AuthedAiSettingsRequest = FastifyRequest & { auth: AiSettingsAuthContext };

type RoleConfigDetails = {
  persona: string;
  activationJudgePrompt: string;
  channelIds: number[];
  model: string;
  thinkingEnabled: boolean;
  shortTermMemory: string;
  midTermMemory: string;
  longTermMemory: string;
};

type AiRoleSyncInput = {
  displayName: string;
  persona: string;
  enabled?: boolean;
  activationJudgePrompt?: string;
  channelIds?: number[];
  model?: string;
  thinkingEnabled?: boolean;
  shortTermMemory?: string;
  midTermMemory?: string;
  longTermMemory?: string;
};

export type AiSettingsRouteDependencies = {
  prisma: PrismaClient;
  requireAuth: preHandlerHookHandler;
  requireAdmin: preHandlerHookHandler;
  io: { to(room: string): { emit(event: string, payload: unknown): unknown } };
  aiSettings: AiSettingsStore;
  setSetting(key: string, value: string): Promise<void>;
  canAccessChannel(accountId: number, channelId: number): Promise<boolean>;
  canonicalPrayerMessage(message: Message): Promise<Message>;
  hydrateMessage(id: number, viewerAccountId?: number): Promise<MessageDTO | null>;
  ensureAiRoleCharacter(username: string, fallbackName: string, displayName?: string): Promise<Actor>;
  ensureWhyAssistantCharacter(displayName?: string): Promise<Actor>;
  roleConfigDetails(rawConfig: unknown): RoleConfigDetails;
  normalizeRoleModel(value?: unknown): string;
  syncAiRoleVirtualCharacterConfig(username: string, fallbackName: string, input: AiRoleSyncInput): Promise<Actor>;
};

export function registerAiSettingsRoutes(app: FastifyInstance, deps: AiSettingsRouteDependencies) {
  const {
    prisma,
    requireAuth,
    requireAdmin,
    io,
    aiSettings,
    setSetting,
    canAccessChannel,
    canonicalPrayerMessage,
    hydrateMessage,
    ensureAiRoleCharacter,
    ensureWhyAssistantCharacter,
    roleConfigDetails,
    normalizeRoleModel,
    syncAiRoleVirtualCharacterConfig
  } = deps;

  async function aiSettingsDto() {
    const base = (await aiSettings.loadAiSettings(true)).value;
    const rows = await prisma.setting.findMany({
      where: {
        key: {
          in: [
            "whyAssistantEnabled",
            "whyAssistantPromptCommand",
            "whyAssistantActivationJudgePrompt",
            "whyAssistantWebSearchEnabled",
            "whyAssistantDisplayName",
            "whyAssistantModel",
            "whyAssistantThinkingEnabled",
            "questionAssistantEnabled",
            "questionAssistantTriggerEnabled",
            "questionAssistantPromptCommand",
            "questionAssistantActivationJudgePrompt",
            "questionAssistantWebSearchEnabled",
            "questionAssistantDisplayName",
            "questionAssistantModel",
            "questionAssistantThinkingEnabled",
            "questionAssistantContextTurnLimit",
            "questionAssistantContextWindowMinutes"
          ]
        }
      }
    });
    const settings = new Map(rows.map((row) => [row.key, row.value]));
    const whyActor = await ensureWhyAssistantCharacter(settings.get("whyAssistantDisplayName") || WHY_ASSISTANT_NAME);
    const questionActor = await ensureAiRoleCharacter(QUESTION_ASSISTANT_USERNAME, QUESTION_ASSISTANT_NAME, settings.get("questionAssistantDisplayName") || QUESTION_ASSISTANT_NAME);
    const [whyCharacter, questionCharacter] = await Promise.all([
      prisma.virtualCharacter.findUnique({ where: { actorId: whyActor.id } }),
      prisma.virtualCharacter.findUnique({ where: { actorId: questionActor.id } })
    ]);
    const whyConfig = roleConfigDetails(whyCharacter?.config);
    const questionConfig = roleConfigDetails(questionCharacter?.config);
    const aiRoles: AiRoleDTO[] = [
      {
        username: WHY_ASSISTANT_USERNAME,
        displayName: whyActor.displayName,
        avatarPath: whyActor.avatarPath,
        enabled: settings.get("whyAssistantEnabled") !== "false",
        model: normalizeRoleModel(settings.get("whyAssistantModel")) || whyConfig.model,
        thinkingEnabled: settings.get("whyAssistantThinkingEnabled") === "true",
        promptCommand: settings.get("whyAssistantPromptCommand") || DEFAULT_WHY_ASSISTANT_PROMPT,
        shortTermMemory: whyConfig.shortTermMemory,
        midTermMemory: whyConfig.midTermMemory,
        longTermMemory: whyConfig.longTermMemory,
        channelIds: whyConfig.channelIds,
        activationJudgePrompt: settings.get("whyAssistantActivationJudgePrompt") || whyConfig.activationJudgePrompt,
        webSearchEnabled: settings.get("whyAssistantWebSearchEnabled") !== "false"
      },
      {
        username: QUESTION_ASSISTANT_USERNAME,
        displayName: questionActor.displayName,
        avatarPath: questionActor.avatarPath,
        enabled: settings.get("questionAssistantEnabled") !== "false",
        model: normalizeRoleModel(settings.get("questionAssistantModel")) || questionConfig.model,
        thinkingEnabled: settings.get("questionAssistantThinkingEnabled") === "true",
        promptCommand: settings.get("questionAssistantPromptCommand") || DEFAULT_QUESTION_ASSISTANT_PROMPT,
        shortTermMemory: questionConfig.shortTermMemory,
        midTermMemory: questionConfig.midTermMemory,
        longTermMemory: questionConfig.longTermMemory,
        channelIds: questionConfig.channelIds,
        activationJudgePrompt: settings.get("questionAssistantActivationJudgePrompt") || questionConfig.activationJudgePrompt || DEFAULT_QUESTION_ASSISTANT_JUDGE_PROMPT,
        webSearchEnabled: settings.get("questionAssistantWebSearchEnabled") !== "false",
        questionTriggerEnabled: settings.get("questionAssistantTriggerEnabled") !== "false",
        contextTurnLimit: clampInteger(settings.get("questionAssistantContextTurnLimit"), DEFAULT_QUESTION_ASSISTANT_CONTEXT_TURNS, 1, 50),
        contextWindowMinutes: clampInteger(settings.get("questionAssistantContextWindowMinutes"), DEFAULT_QUESTION_ASSISTANT_CONTEXT_WINDOW_MINUTES, 1, 1440)
      }
    ];
    return {
      ...base,
      whyAssistantEnabled: settings.get("whyAssistantEnabled") !== "false",
      whyAssistantWebSearchEnabled: settings.get("whyAssistantWebSearchEnabled") !== "false",
      whyAssistantPromptCommand: settings.get("whyAssistantPromptCommand") || DEFAULT_WHY_ASSISTANT_PROMPT,
      aiRoles
    };
  }

  function buildRelatedVersesContext(message: Message & { sender: Actor }, previousReferences: string[]) {
    const lines = [
      "上下文内容：",
      `代祷发起人：${message.sender.displayName}`,
      `代祷信息：${plainTextFromHtml(message.content, 2000) || "代祷事项"}`,
      "",
      previousReferences.length ? `已推荐过的出处：${previousReferences.join("；")}` : "已推荐过的出处：无",
      "",
      "请输出 3 行，每行只有一个经文出处。"
    ];
    return lines.join("\n").slice(0, 5000);
  }

  app.get("/api/admin/ai-settings", { preHandler: requireAdmin }, async () => {
    return aiSettingsDto();
  });

  app.post("/api/admin/ai-settings", { preHandler: requireAdmin }, async (request) => {
    const body = z
      .object({
        enabled: z.boolean().optional(),
        apiKey: z.string().max(400).optional(),
        clearApiKey: z.boolean().optional(),
        promptCommand: z.string().max(4000).optional(),
        cardCooldownSeconds: z.number().min(0).max(3600).optional(),
        userLimitPerMinute: z.number().min(1).max(60).optional(),
        maxSuccessPerMessage: z.number().min(1).max(20).optional(),
        whyAssistantEnabled: z.boolean().optional(),
        whyAssistantWebSearchEnabled: z.boolean().optional(),
        whyAssistantPromptCommand: z.string().max(6000).optional(),
        aiRoles: z
          .array(
            z.object({
              username: z.string().max(80),
              displayName: z.string().min(1).max(80).optional(),
              enabled: z.boolean().optional(),
              model: z.string().max(120).optional(),
              thinkingEnabled: z.boolean().optional(),
              promptCommand: z.string().max(6000).optional(),
              shortTermMemory: z.string().max(8000).optional(),
              midTermMemory: z.string().max(8000).optional(),
              longTermMemory: z.string().max(8000).optional(),
              channelIds: z.array(z.number()).optional(),
              activationJudgePrompt: z.string().max(6000).optional(),
              webSearchEnabled: z.boolean().optional(),
              questionTriggerEnabled: z.boolean().optional(),
              contextTurnLimit: z.number().min(1).max(50).optional(),
              contextWindowMinutes: z.number().min(1).max(1440).optional()
            })
          )
          .optional()
      })
      .parse(request.body);
    if (Object.prototype.hasOwnProperty.call(body, "enabled")) await setSetting("aiRelatedVersesEnabled", body.enabled ? "true" : "false");
    if (body.clearApiKey) await setSetting("aiDeepSeekApiKeyEncrypted", "");
    if (body.apiKey?.trim()) await setSetting("aiDeepSeekApiKeyEncrypted", aiSettings.encryptAiApiKey(body.apiKey.trim()));
    if (Object.prototype.hasOwnProperty.call(body, "promptCommand")) await setSetting("aiRelatedVersesPromptCommand", (body.promptCommand || "").trim() || DEFAULT_AI_PROMPT_COMMAND);
    if (Object.prototype.hasOwnProperty.call(body, "cardCooldownSeconds")) await setSetting("aiRelatedVersesCardCooldownSeconds", String(clampInteger(body.cardCooldownSeconds, DEFAULT_AI_SETTINGS.cardCooldownSeconds, 0, 3600)));
    if (Object.prototype.hasOwnProperty.call(body, "userLimitPerMinute")) await setSetting("aiRelatedVersesUserLimitPerMinute", String(clampInteger(body.userLimitPerMinute, DEFAULT_AI_SETTINGS.userLimitPerMinute, 1, 60)));
    if (Object.prototype.hasOwnProperty.call(body, "maxSuccessPerMessage")) await setSetting("aiRelatedVersesMaxSuccessPerMessage", String(clampInteger(body.maxSuccessPerMessage, DEFAULT_AI_SETTINGS.maxSuccessPerMessage, 1, 20)));
    if (Object.prototype.hasOwnProperty.call(body, "whyAssistantEnabled")) await setSetting("whyAssistantEnabled", body.whyAssistantEnabled ? "true" : "false");
    if (Object.prototype.hasOwnProperty.call(body, "whyAssistantWebSearchEnabled")) await setSetting("whyAssistantWebSearchEnabled", body.whyAssistantWebSearchEnabled ? "true" : "false");
    if (Object.prototype.hasOwnProperty.call(body, "whyAssistantPromptCommand")) await setSetting("whyAssistantPromptCommand", (body.whyAssistantPromptCommand || "").trim() || DEFAULT_WHY_ASSISTANT_PROMPT);
    for (const role of body.aiRoles || []) {
      if (role.username === WHY_ASSISTANT_USERNAME) {
        const displayName = (role.displayName || "").trim() || WHY_ASSISTANT_NAME;
        await setSetting("whyAssistantDisplayName", displayName);
        if (Object.prototype.hasOwnProperty.call(role, "enabled")) await setSetting("whyAssistantEnabled", role.enabled ? "true" : "false");
        if (Object.prototype.hasOwnProperty.call(role, "webSearchEnabled")) await setSetting("whyAssistantWebSearchEnabled", role.webSearchEnabled ? "true" : "false");
        if (Object.prototype.hasOwnProperty.call(role, "model")) await setSetting("whyAssistantModel", normalizeRoleModel(role.model));
        if (Object.prototype.hasOwnProperty.call(role, "thinkingEnabled")) await setSetting("whyAssistantThinkingEnabled", role.thinkingEnabled ? "true" : "false");
        if (Object.prototype.hasOwnProperty.call(role, "promptCommand")) await setSetting("whyAssistantPromptCommand", (role.promptCommand || "").trim() || DEFAULT_WHY_ASSISTANT_PROMPT);
        if (Object.prototype.hasOwnProperty.call(role, "activationJudgePrompt")) await setSetting("whyAssistantActivationJudgePrompt", (role.activationJudgePrompt || "").trim());
        await syncAiRoleVirtualCharacterConfig(WHY_ASSISTANT_USERNAME, WHY_ASSISTANT_NAME, {
          displayName,
          persona: (role.promptCommand || "").trim() || DEFAULT_WHY_ASSISTANT_PROMPT,
          enabled: role.enabled,
          activationJudgePrompt: (role.activationJudgePrompt || "").trim(),
          channelIds: role.channelIds,
          model: role.model,
          thinkingEnabled: role.thinkingEnabled,
          shortTermMemory: role.shortTermMemory,
          midTermMemory: role.midTermMemory,
          longTermMemory: role.longTermMemory
        });
      }
      if (role.username === QUESTION_ASSISTANT_USERNAME) {
        const displayName = (role.displayName || "").trim() || QUESTION_ASSISTANT_NAME;
        await setSetting("questionAssistantDisplayName", displayName);
        if (Object.prototype.hasOwnProperty.call(role, "enabled")) await setSetting("questionAssistantEnabled", role.enabled ? "true" : "false");
        if (Object.prototype.hasOwnProperty.call(role, "questionTriggerEnabled")) await setSetting("questionAssistantTriggerEnabled", role.questionTriggerEnabled ? "true" : "false");
        if (Object.prototype.hasOwnProperty.call(role, "webSearchEnabled")) await setSetting("questionAssistantWebSearchEnabled", role.webSearchEnabled ? "true" : "false");
        if (Object.prototype.hasOwnProperty.call(role, "model")) await setSetting("questionAssistantModel", normalizeRoleModel(role.model));
        if (Object.prototype.hasOwnProperty.call(role, "thinkingEnabled")) await setSetting("questionAssistantThinkingEnabled", role.thinkingEnabled ? "true" : "false");
        if (Object.prototype.hasOwnProperty.call(role, "promptCommand")) await setSetting("questionAssistantPromptCommand", (role.promptCommand || "").trim() || DEFAULT_QUESTION_ASSISTANT_PROMPT);
        if (Object.prototype.hasOwnProperty.call(role, "activationJudgePrompt")) {
          await setSetting("questionAssistantActivationJudgePrompt", (role.activationJudgePrompt || "").trim() || DEFAULT_QUESTION_ASSISTANT_JUDGE_PROMPT);
        }
        if (Object.prototype.hasOwnProperty.call(role, "contextTurnLimit")) {
          await setSetting("questionAssistantContextTurnLimit", String(clampInteger(role.contextTurnLimit, DEFAULT_QUESTION_ASSISTANT_CONTEXT_TURNS, 1, 50)));
        }
        if (Object.prototype.hasOwnProperty.call(role, "contextWindowMinutes")) {
          await setSetting("questionAssistantContextWindowMinutes", String(clampInteger(role.contextWindowMinutes, DEFAULT_QUESTION_ASSISTANT_CONTEXT_WINDOW_MINUTES, 1, 1440)));
        }
        await syncAiRoleVirtualCharacterConfig(QUESTION_ASSISTANT_USERNAME, QUESTION_ASSISTANT_NAME, {
          displayName,
          persona: (role.promptCommand || "").trim() || DEFAULT_QUESTION_ASSISTANT_PROMPT,
          enabled: role.enabled,
          activationJudgePrompt: (role.activationJudgePrompt || "").trim() || DEFAULT_QUESTION_ASSISTANT_JUDGE_PROMPT,
          channelIds: role.channelIds,
          model: role.model,
          thinkingEnabled: role.thinkingEnabled,
          shortTermMemory: role.shortTermMemory,
          midTermMemory: role.midTermMemory,
          longTermMemory: role.longTermMemory
        });
      }
    }
    aiSettings.resetAiSettingsCache();
    return aiSettingsDto();
  });

  app.post("/api/admin/ai-roles/:username/avatar", { preHandler: requireAdmin }, async (request, reply) => {
    const username = (request.params as { username: string }).username;
    if (!AI_ROLE_USERNAMES.has(username)) return reply.code(404).send({ success: false, message: "AI 角色不存在" });
    const fallbackName = username === WHY_ASSISTANT_USERNAME ? WHY_ASSISTANT_NAME : QUESTION_ASSISTANT_NAME;
    const displayNameKey = username === WHY_ASSISTANT_USERNAME ? "whyAssistantDisplayName" : "questionAssistantDisplayName";
    const displayName = (await prisma.setting.findUnique({ where: { key: displayNameKey } }))?.value || fallbackName;
    const actor = await ensureAiRoleCharacter(username, fallbackName, displayName);
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
    const updated = await prisma.actor.update({ where: { id: actor.id }, data: { avatarPath } });
    const settings = await aiSettingsDto();
    const role = settings.aiRoles?.find((item) => item.username === username);
    return { success: true, role: role || { username, displayName: updated.displayName, avatarPath: updated.avatarPath, enabled: true, promptCommand: "" } };
  });

  app.post("/api/messages/:messageId/ai-suggestions/related-verses", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedAiSettingsRequest).auth;
    const messageId = Number((request.params as { messageId: string }).messageId);
    const message = await prisma.message.findUnique({ where: { id: messageId }, include: { sender: true } });
    if (!message || message.type !== "prayer") return reply.code(404).send({ success: false, message: "代祷事项不存在" });
    if (!(await canAccessChannel(auth.accountId, message.channelId))) return reply.code(403).send({ success: false, message: "无权访问此代祷" });
    const target = await canonicalPrayerMessage(message);
    const targetMessageId = target.id;
    const targetWithSender =
      targetMessageId === message.id ? message : await prisma.message.findUniqueOrThrow({ where: { id: targetMessageId }, include: { sender: true } });

    const loaded = await aiSettings.loadAiSettings();
    const settings: AiSettingsDTO = loaded.value;
    const apiKey = aiSettings.decryptAiApiKey(loaded.encryptedApiKey);
    if (!settings.enabled || !apiKey) return reply.code(409).send({ success: false, message: aiConfigurationMessage(auth) });

    const successCount = await prisma.messageAiSuggestion.count({ where: { messageId: targetMessageId, kind: AI_RELATED_VERSES_KIND, status: "success" } });
    if (successCount >= settings.maxSuccessPerMessage) {
      return reply.code(409).send({ success: false, message: "这张代祷卡片的经文建议已达到上限" });
    }

    const now = new Date();
    const latestForMessage = await prisma.messageAiSuggestion.findFirst({
      where: { messageId: targetMessageId, kind: AI_RELATED_VERSES_KIND, status: "success" },
      orderBy: { createdAt: "desc" }
    });
    const nextAllowedAt = latestForMessage ? latestForMessage.createdAt.getTime() + settings.cardCooldownSeconds * 1000 : 0;
    if (settings.cardCooldownSeconds > 0 && nextAllowedAt > now.getTime()) {
      const seconds = Math.max(1, Math.ceil((nextAllowedAt - now.getTime()) / 1000));
      return reply.code(429).send({ success: false, message: `请 ${seconds} 秒后再换一组经文建议` });
    }

    const userWindowStart = new Date(now.getTime() - 60_000);
    const userRequests = await prisma.messageAiSuggestion.count({
      where: { createdByAccountId: auth.accountId, kind: AI_RELATED_VERSES_KIND, createdAt: { gte: userWindowStart } }
    });
    if (userRequests >= settings.userLimitPerMinute) {
      return reply.code(429).send({ success: false, message: "生成太频繁了，请稍后再试" });
    }

    const previousRows = await prisma.messageAiSuggestion.findMany({
      where: { messageId: targetMessageId, kind: AI_RELATED_VERSES_KIND, status: "success" },
      select: { references: true },
      orderBy: { createdAt: "desc" }
    });
    const previousReferences = previousRows.flatMap((row) => (Array.isArray(row.references) ? row.references.map(String).filter(Boolean) : []));
    const contextText = buildRelatedVersesContext(targetWithSender, previousReferences);
    try {
      const result = await callDeepSeekRelatedVerses(settings, apiKey, contextText);
      await prisma.messageAiSuggestion.create({
        data: {
          messageId: targetMessageId,
          kind: AI_RELATED_VERSES_KIND,
          status: "success",
          promptCommand: settings.promptCommand,
          contextText,
          responseText: result.responseText,
          references: result.references as Prisma.InputJsonArray,
          model: settings.model,
          baseUrl: settings.baseUrl,
          createdByAccountId: auth.accountId
        }
      });
      const dto = await hydrateMessage(messageId, auth.accountId);
      if (dto) io.to(`ch:${message.channelId}`).emit("message:updated", dto);
      return { success: true, message: dto };
    } catch (error) {
      await prisma.messageAiSuggestion.create({
        data: {
          messageId: targetMessageId,
          kind: AI_RELATED_VERSES_KIND,
          status: "failed",
          promptCommand: settings.promptCommand,
          contextText,
          errorText: cleanAiError(error),
          model: settings.model,
          baseUrl: settings.baseUrl,
          createdByAccountId: auth.accountId
        }
      });
      request.log.warn({ error }, "AI related verses generation failed");
      return reply.code(502).send({ success: false, message: auth.isAdmin ? `AI 生成失败：${cleanAiError(error)}` : "生成失败，可以稍后重试。" });
    }
  });
}
