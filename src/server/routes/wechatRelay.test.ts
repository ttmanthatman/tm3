import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { DEFAULT_WECHAT_RELAY_TEMPLATES } from "../../shared/wechatRelayNotifications.js";
import { normalizeWeChatRelayNasAccessUrl, registerWeChatRelayRoutes } from "./wechatRelay.js";

function createHarness(environmentToken = "agent-test-token", allowAdmin = true, nasAccessUrl: string | null = "https://nas.example.com/wechat/") {
  const settings = new Map<string, string>();
  const rows = [
    {
      id: 11,
      channelId: 7,
      senderActorId: 3,
      content: "new notification",
      type: "text",
      payload: null,
      fileName: null,
      filePath: null,
      fileSize: null,
      replyToId: null,
      chainRootId: null,
      chainVersion: null,
      musicOrder: null,
      createdAt: new Date("2026-08-21T00:00:00Z"),
      sender: { id: 3, kind: "human", username: "sender", displayName: "发送者" }
    }
  ];
  const prisma = {
    setting: {
      findUnique: async ({ where }: { where: { key: string } }) => settings.has(where.key)
        ? { key: where.key, value: settings.get(where.key) as string, updatedAt: new Date() }
        : null,
      upsert: async (input: { where: { key: string }; update: { value: string } }) => {
        settings.set(input.where.key, input.update.value);
        return { key: input.where.key, value: input.update.value, updatedAt: new Date() };
      },
      deleteMany: async ({ where }: { where: { key: string } }) => {
        const count = settings.delete(where.key) ? 1 : 0;
        return { count };
      }
    },
    channel: {
      findUnique: async ({ where }: { where: { id: number } }) => where.id === 7 ? { id: 7, kind: "standard" } : null
    },
    message: {
      aggregate: async () => ({ _max: { id: 10 } }),
      findMany: async ({ where }: { where: { channelId: number; id: { gt: number } } }) =>
        rows.filter((row) => row.channelId === where.channelId && row.id > where.id.gt)
    }
  } as unknown as PrismaClient;
  const app = Fastify();
  registerWeChatRelayRoutes(app, {
    prisma,
    requireAdmin: async (_request, reply) => {
      if (!allowAdmin) reply.code(403).send({ success: false, message: "管理员权限不足" });
    },
    agentToken: environmentToken,
    nasAccessUrl
  });
  return { app, settings };
}

test("admin configuration starts after existing messages and agent actions round-trip", async () => {
  const { app } = createHarness();
  await app.ready();
  try {
    const saved = await app.inject({
      method: "PUT",
      url: "/api/admin/wechat-relay",
      payload: {
        enabled: true,
        channelId: 7,
        targetGroup: "XGS",
        templates: { ...DEFAULT_WECHAT_RELAY_TEMPLATES, message: ["{name}真的说话了"] }
      }
    });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json().config.startAfterId, 10);

    const unauthorized = await app.inject({ method: "GET", url: "/api/wechat-relay/agent/config" });
    assert.equal(unauthorized.statusCode, 401);

    const headers = { authorization: "Bearer agent-test-token" };
    const messages = await app.inject({ method: "GET", url: "/api/wechat-relay/agent/messages?after=0", headers });
    assert.equal(messages.statusCode, 200);
    assert.deepEqual(messages.json().messages.map((message: { id: number }) => message.id), [11]);
    assert.equal(messages.json().messages[0].relayText, "发送者真的说话了");
    assert.doesNotMatch(messages.json().messages[0].relayText, /new notification|#11|2026/);

    const heartbeat = await app.inject({
      method: "POST",
      url: "/api/wechat-relay/agent/heartbeat",
      headers,
      payload: { deviceName: "NAS 微信虚拟机", driverReady: false, queue: {}, attention: 0 }
    });
    assert.equal(heartbeat.statusCode, 200);

    const calibration = await app.inject({ method: "POST", url: "/api/admin/wechat-relay/actions", payload: { type: "calibrate" } });
    assert.equal(calibration.statusCode, 200);
    const calibrationId = calibration.json().action.id as string;
    const calibrationResult = await app.inject({
      method: "POST",
      url: "/api/wechat-relay/agent/action-result",
      headers,
      payload: { actionId: calibrationId, success: true, message: "已绑定微信群 XGS" }
    });
    assert.equal(calibrationResult.statusCode, 200);

    const testAction = await app.inject({ method: "POST", url: "/api/admin/wechat-relay/actions", payload: { type: "test" } });
    assert.equal(testAction.statusCode, 200);
    assert.equal(testAction.json().action.text, "测试消息到了，微信通知连接正常");

    const state = await app.inject({ method: "GET", url: "/api/admin/wechat-relay" });
    assert.equal(state.json().agent.online, true);
    assert.equal(state.json().agent.calibratedTarget, "XGS");
    assert.equal(state.json().config.pendingAction.type, "test");
  } finally {
    await app.close();
  }
});

test("invalid channels and incomplete enabled settings fail closed", async () => {
  const { app } = createHarness();
  await app.ready();
  try {
    const incomplete = await app.inject({ method: "PUT", url: "/api/admin/wechat-relay", payload: { enabled: true, channelId: null, targetGroup: "", templates: DEFAULT_WECHAT_RELAY_TEMPLATES } });
    assert.equal(incomplete.statusCode, 400);
    const invalidChannel = await app.inject({ method: "PUT", url: "/api/admin/wechat-relay", payload: { enabled: false, channelId: 99, targetGroup: "XGS", templates: DEFAULT_WECHAT_RELAY_TEMPLATES } });
    assert.equal(invalidChannel.statusCode, 400);
    const emptyTemplates = await app.inject({
      method: "PUT",
      url: "/api/admin/wechat-relay",
      payload: { enabled: false, channelId: 7, targetGroup: "XGS", templates: { ...DEFAULT_WECHAT_RELAY_TEMPLATES, message: [] } }
    });
    assert.equal(emptyTemplates.statusCode, 400);
  } finally {
    await app.close();
  }
});

test("admins can set, generate, and remove a one-way device credential", async () => {
  const { app, settings } = createHarness("environment-token-that-is-long-enough");
  await app.ready();
  try {
    const initial = await app.inject({ method: "GET", url: "/api/admin/wechat-relay" });
    assert.equal(initial.json().tokenSource, "environment");
    assert.equal(initial.json().nasAccessUrl, "https://nas.example.com/wechat/");

    const weak = await app.inject({ method: "PUT", url: "/api/admin/wechat-relay/token", payload: { token: "too-short" } });
    assert.equal(weak.statusCode, 400);

    const customToken = "administrator-managed-token-123456";
    const saved = await app.inject({ method: "PUT", url: "/api/admin/wechat-relay/token", payload: { token: customToken } });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json().tokenSource, "admin");
    assert.doesNotMatch(settings.get("wechatRelayAgentCredential") || "", new RegExp(customToken));

    const oldToken = await app.inject({
      method: "GET",
      url: "/api/wechat-relay/agent/config",
      headers: { authorization: "Bearer environment-token-that-is-long-enough" }
    });
    assert.equal(oldToken.statusCode, 401);
    const newToken = await app.inject({
      method: "GET",
      url: "/api/wechat-relay/agent/config",
      headers: { authorization: `Bearer ${customToken}` }
    });
    assert.equal(newToken.statusCode, 200);

    const generated = await app.inject({ method: "POST", url: "/api/admin/wechat-relay/token" });
    assert.equal(generated.statusCode, 200);
    assert.match(generated.json().token, /^[A-Za-z0-9_-]{40,}$/);
    assert.doesNotMatch(settings.get("wechatRelayAgentCredential") || "", new RegExp(generated.json().token));

    const removed = await app.inject({ method: "DELETE", url: "/api/admin/wechat-relay/token" });
    assert.equal(removed.statusCode, 200);
    assert.equal(removed.json().tokenSource, "environment");
  } finally {
    await app.close();
  }
});

test("NAS access URL accepts only credential-free HTTP(S) links", () => {
  assert.equal(normalizeWeChatRelayNasAccessUrl(undefined), null);
  assert.equal(normalizeWeChatRelayNasAccessUrl("  https://nas.example.com/wechat  "), "https://nas.example.com/wechat");
  assert.throws(() => normalizeWeChatRelayNasAccessUrl("not a URL"), /valid HTTP\(S\)/);
  assert.throws(() => normalizeWeChatRelayNasAccessUrl("javascript:alert(1)"), /HTTP\(S\)/);
  assert.throws(() => normalizeWeChatRelayNasAccessUrl("https://user:secret@nas.example.com/"), /credentials/);
});

test("device credential controls remain administrator-only", async () => {
  const { app } = createHarness("", false);
  await app.ready();
  try {
    const generated = await app.inject({ method: "POST", url: "/api/admin/wechat-relay/token" });
    assert.equal(generated.statusCode, 403);
    const updated = await app.inject({
      method: "PUT",
      url: "/api/admin/wechat-relay/token",
      payload: { token: "unauthorized-token-value-123456" }
    });
    assert.equal(updated.statusCode, 403);
  } finally {
    await app.close();
  }
});
