import assert from "node:assert/strict";
import test from "node:test";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import type { Actor, Message, PrismaClient } from "@prisma/client";
import type { MessageDTO } from "../../shared/types.js";
import { createAiSettingsStore } from "../aiSettings.js";
import { registerAiSettingsRoutes } from "./aiSettings.js";

const FAKE_ASR_KEY = "sk-fake-asr-test-key";

function createHarness() {
  const settings = new Map<string, string>();
  const prisma = {
    setting: {
      findMany: async ({ where }: { where: { key: { in: string[] } } }) =>
        where.key.in.filter((key) => settings.has(key)).map((key) => ({ key, value: settings.get(key)! }))
    },
    virtualCharacter: {
      findUnique: async () => null
    }
  } as unknown as PrismaClient;

  const aiSettings = createAiSettingsStore({ prisma, secret: "asr-route-test-secret" });
  const io = {
    to: () => ({ emit: () => {} })
  };
  const requireAdmin = async (request: FastifyRequest, _reply: FastifyReply) => {
    (request as FastifyRequest & { auth: unknown }).auth = { accountId: 1, isAdmin: true };
  };
  const fakeActor = (id: number, displayName: string) => ({ id, displayName, avatarPath: null }) as unknown as Actor;

  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ success: false, message: "invalid request", issues: error.issues });
    return reply.code(500).send({ success: false, message: "server error" });
  });
  registerAiSettingsRoutes(app, {
    prisma,
    requireAuth: requireAdmin,
    requireAdmin,
    io,
    aiSettings,
    setSetting: async (key, value) => {
      settings.set(key, value);
    },
    canAccessChannel: async () => true,
    canonicalPrayerMessage: async (message) => message as Message,
    hydrateMessage: async (id) => ({ id }) as MessageDTO,
    ensureAiRoleCharacter: async (username, fallbackName, displayName) => fakeActor(2, displayName || fallbackName || username),
    ensureWhyAssistantCharacter: async (displayName) => fakeActor(1, displayName || "为什么助手"),
    roleConfigDetails: () => ({
      persona: "",
      activationJudgePrompt: "",
      channelIds: [],
      model: "",
      thinkingEnabled: false,
      shortTermMemory: "",
      midTermMemory: "",
      longTermMemory: ""
    }),
    normalizeRoleModel: (value) => String(value || ""),
    syncAiRoleVirtualCharacterConfig: async (username, fallbackName, input) => fakeActor(2, input.displayName || fallbackName || username)
  });
  return { app, settings };
}

test("GET /api/admin/ai-settings always returns asr defaults without a key", async () => {
  const { app } = createHarness();
  await app.ready();
  try {
    const response = await app.inject({ method: "GET", url: "/api/admin/ai-settings" });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.deepEqual(body.asr, {
      enabled: true,
      apiKeyConfigured: false,
      baseUrl: "https://api.xiaomimimo.com/v1",
      model: "mimo-v2.5-asr",
      language: "auto"
    });
  } finally {
    await app.close();
  }
});

test("POST /api/admin/ai-settings stores asr settings and never returns the api key", async () => {
  const { app, settings } = createHarness();
  await app.ready();
  try {
    const post = await app.inject({
      method: "POST",
      url: "/api/admin/ai-settings",
      payload: {
        asr: {
          enabled: false,
          apiKey: FAKE_ASR_KEY,
          baseUrl: "https://asr.example.com/v1",
          model: "mimo-custom",
          language: "zh"
        }
      }
    });
    assert.equal(post.statusCode, 200);
    const posted = post.json();
    assert.deepEqual(posted.asr, {
      enabled: false,
      apiKeyConfigured: true,
      baseUrl: "https://asr.example.com/v1",
      model: "mimo-custom",
      language: "zh"
    });
    assert.ok(!JSON.stringify(posted).includes(FAKE_ASR_KEY));
    const stored = settings.get("aiAsrApiKeyEncrypted") || "";
    assert.ok(stored.startsWith("v1:"));
    assert.ok(!stored.includes(FAKE_ASR_KEY));

    const get = await app.inject({ method: "GET", url: "/api/admin/ai-settings" });
    const fetched = get.json();
    assert.equal(fetched.asr.apiKeyConfigured, true);
    assert.equal(fetched.asr.enabled, false);
    assert.equal(fetched.asr.language, "zh");
    assert.ok(!JSON.stringify(fetched).includes(FAKE_ASR_KEY));
  } finally {
    await app.close();
  }
});

test("POST /api/admin/ai-settings clearApiKey removes the stored asr key", async () => {
  const { app } = createHarness();
  await app.ready();
  try {
    await app.inject({ method: "POST", url: "/api/admin/ai-settings", payload: { asr: { apiKey: FAKE_ASR_KEY } } });
    const cleared = await app.inject({ method: "POST", url: "/api/admin/ai-settings", payload: { asr: { clearApiKey: true } } });
    assert.equal(cleared.statusCode, 200);
    assert.equal(cleared.json().asr.apiKeyConfigured, false);
  } finally {
    await app.close();
  }
});

test("POST /api/admin/ai-settings rejects an unsupported asr language", async () => {
  const { app } = createHarness();
  await app.ready();
  try {
    const response = await app.inject({ method: "POST", url: "/api/admin/ai-settings", payload: { asr: { language: "fr" } } });
    assert.equal(response.statusCode, 400);
  } finally {
    await app.close();
  }
});
