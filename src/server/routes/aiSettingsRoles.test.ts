import assert from "node:assert/strict";
import test from "node:test";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import type { Actor, PrismaClient } from "@prisma/client";
import type { AiRoleDTO, MessageDTO } from "../../shared/types.js";
import { QUESTION_ASSISTANT_MEDIA_PROTOCOL } from "../../shared/virtualCharacters.js";
import { createAiSettingsStore } from "../aiSettings.js";
import { registerAiSettingsRoutes, type AiSettingsRouteDependencies } from "./aiSettings.js";

function createHarness(isAdmin = true) {
  const settings = new Map<string, string>();
  const synced: Array<Parameters<AiSettingsRouteDependencies["syncAiRoleVirtualCharacterConfig"]>[2]> = [];
  const prisma = {
    setting: {
      findMany: async ({ where }: { where: { key: { in: string[] } } }) =>
        where.key.in.filter((key) => settings.has(key)).map((key) => ({ key, value: settings.get(key)! }))
    },
    virtualCharacter: { findUnique: async () => null }
  } as unknown as PrismaClient;
  const actor = (id: number, displayName: string) => ({ id, displayName, avatarPath: null }) as Actor;
  const requireAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isAdmin) return reply.code(403).send({ message: "admin required" });
    (request as FastifyRequest & { auth: unknown }).auth = { accountId: 1, isAdmin: true };
  };
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ message: "invalid request" });
    return reply.code(500).send({ message: "server error" });
  });
  registerAiSettingsRoutes(app, {
    prisma, requireAuth: requireAdmin, requireAdmin,
    io: { to: () => ({ emit: () => {} }) },
    aiSettings: createAiSettingsStore({ prisma, secret: "role-route-test-secret" }),
    setSetting: async (key, value) => { settings.set(key, value); },
    canAccessChannel: async () => true,
    canonicalPrayerMessage: async (message) => message,
    canonicalGraceMessage: async (message) => message,
    hydrateMessage: async (id) => ({ id }) as MessageDTO,
    ensureAiRoleCharacter: async (_username, fallbackName, displayName) => actor(2, displayName || fallbackName),
    ensureWhyAssistantCharacter: async (displayName) => actor(1, displayName || "为什么助手"),
    roleConfigDetails: () => ({ persona: "", activationJudgePrompt: "", channelIds: [], model: "", thinkingEnabled: false, shortTermMemory: "", midTermMemory: "", longTermMemory: "" }),
    normalizeRoleModel: (value) => String(value || ""),
    syncAiRoleVirtualCharacterConfig: async (_username, fallbackName, input) => {
      synced.push(input);
      return actor(2, input.displayName || fallbackName);
    }
  });
  const role = (body: { aiRoles: AiRoleDTO[] }, username = "ai_slmm") => body.aiRoles.find((item) => item.username === username)!;
  return { app, settings, synced, role };
}

test("role settings expose the real base prompt and keep old activation duration", async () => {
  const h = createHarness();
  h.settings.set("questionAssistantContextWindowMinutes", "17");
  try {
    const response = await h.app.inject({ method: "GET", url: "/api/admin/ai-settings" });
    assert.equal(response.statusCode, 200);
    assert.equal(h.role(response.json()).systemPrompt, QUESTION_ASSISTANT_MEDIA_PROTOCOL);
    assert.equal(h.role(response.json()).activationDurationMinutes, 17);
    assert.equal(h.role(response.json(), "why_assistant").systemPrompt, "");
  } finally { await h.app.close(); }
});

test("saving role prompts and activation duration updates settings and runtime config independently", async () => {
  const h = createHarness();
  try {
    const response = await h.app.inject({ method: "POST", url: "/api/admin/ai-settings", payload: { aiRoles: [{
      username: "ai_slmm", systemPrompt: "自定义底层指令", activationJudgePrompt: "自定义激活判断", activationDurationMinutes: 3, contextWindowMinutes: 45, contextTurnLimit: 8
    }] } });
    assert.equal(response.statusCode, 200);
    assert.equal(h.settings.get("questionAssistantSystemPrompt"), "自定义底层指令");
    assert.equal(h.settings.get("questionAssistantActivationDurationMinutes"), "3");
    assert.equal(h.role(response.json()).activationDurationMinutes, 3);
    assert.equal(h.role(response.json()).contextWindowMinutes, 45);
    assert.equal(h.role(response.json()).contextTurnLimit, 8);
    assert.equal(h.synced[0].systemPrompt, "自定义底层指令");
    assert.equal(h.synced[0].activationDurationMinutes, 3);
    assert.equal(h.synced[0].activationJudgePrompt, "自定义激活判断");
  } finally { await h.app.close(); }
});

test("partial role updates preserve saved persona, base prompt and activation settings", async () => {
  const h = createHarness();
  h.settings.set("questionAssistantPromptCommand", "管理员的人设");
  h.settings.set("questionAssistantSystemPrompt", "管理员的系统提示");
  h.settings.set("questionAssistantActivationJudgePrompt", "保留判断");
  h.settings.set("questionAssistantActivationDurationMinutes", "7");
  h.settings.set("questionAssistantDisplayName", "自定义姓名");
  try {
    const response = await h.app.inject({ method: "POST", url: "/api/admin/ai-settings", payload: { aiRoles: [{ username: "ai_slmm", enabled: false }] } });
    assert.equal(response.statusCode, 200);
    assert.equal(h.synced[0].persona, "管理员的人设");
    assert.equal(h.synced[0].systemPrompt, "管理员的系统提示");
    assert.equal(h.synced[0].activationJudgePrompt, "保留判断");
    assert.equal(h.synced[0].activationDurationMinutes, 7);
    assert.equal(h.settings.get("questionAssistantDisplayName"), "自定义姓名");
    assert.equal(h.role(response.json()).enabled, false);
  } finally { await h.app.close(); }
});

test("the why role can save and clear its additional system prompt", async () => {
  const h = createHarness();
  try {
    for (const systemPrompt of ["研究时请对照上下文", ""]) {
      const response = await h.app.inject({ method: "POST", url: "/api/admin/ai-settings", payload: { aiRoles: [{ username: "why_assistant", systemPrompt }] } });
      assert.equal(response.statusCode, 200);
      assert.equal(h.role(response.json(), "why_assistant").systemPrompt, systemPrompt);
      assert.equal(h.synced.at(-1)!.systemPrompt, systemPrompt);
    }
  } finally { await h.app.close(); }
});

test("activation duration and base prompt limits are validated before settings writes", async () => {
  const h = createHarness();
  try {
    for (const patch of [{ activationDurationMinutes: 0 }, { activationDurationMinutes: 1441 }, { activationDurationMinutes: 1.5 }, { activationDurationMinutes: "3" }, { systemPrompt: "长".repeat(12001) }]) {
      const response = await h.app.inject({ method: "POST", url: "/api/admin/ai-settings", payload: { aiRoles: [{ username: "ai_slmm", ...patch }] } });
      assert.equal(response.statusCode, 400);
    }
    assert.equal(h.settings.size, 0);
    assert.equal(h.synced.length, 0);
  } finally { await h.app.close(); }
});

test("non-admin accounts cannot read or edit role system prompts", async () => {
  const h = createHarness(false);
  try {
    for (const method of ["GET", "POST"] as const) {
      const response = await h.app.inject({ method, url: "/api/admin/ai-settings", ...(method === "POST" ? { payload: { aiRoles: [{ username: "ai_slmm", systemPrompt: "override" }] } } : {}) });
      assert.equal(response.statusCode, 403);
    }
    assert.equal(h.settings.size, 0);
  } finally { await h.app.close(); }
});
