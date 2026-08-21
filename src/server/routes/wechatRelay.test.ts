import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { registerWeChatRelayRoutes } from "./wechatRelay.js";

function createHarness() {
  let settingValue: string | null = null;
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
      findUnique: async () => settingValue ? { key: "wechatRelayConfig", value: settingValue, updatedAt: new Date() } : null,
      upsert: async (input: { update: { value: string } }) => {
        settingValue = input.update.value;
        return { key: "wechatRelayConfig", value: settingValue, updatedAt: new Date() };
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
    requireAdmin: async () => undefined,
    agentToken: "agent-test-token"
  });
  return { app };
}

test("admin configuration starts after existing messages and agent actions round-trip", async () => {
  const { app } = createHarness();
  await app.ready();
  try {
    const saved = await app.inject({
      method: "PUT",
      url: "/api/admin/wechat-relay",
      payload: { enabled: true, channelId: 7, targetGroup: "XGS" }
    });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json().config.startAfterId, 10);

    const unauthorized = await app.inject({ method: "GET", url: "/api/wechat-relay/agent/config" });
    assert.equal(unauthorized.statusCode, 401);

    const headers = { authorization: "Bearer agent-test-token" };
    const messages = await app.inject({ method: "GET", url: "/api/wechat-relay/agent/messages?after=0", headers });
    assert.equal(messages.statusCode, 200);
    assert.deepEqual(messages.json().messages.map((message: { id: number }) => message.id), [11]);

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
    assert.match(testAction.json().action.text, /聊天室微信转发实测/);

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
    const incomplete = await app.inject({ method: "PUT", url: "/api/admin/wechat-relay", payload: { enabled: true, channelId: null, targetGroup: "" } });
    assert.equal(incomplete.statusCode, 400);
    const invalidChannel = await app.inject({ method: "PUT", url: "/api/admin/wechat-relay", payload: { enabled: false, channelId: 99, targetGroup: "XGS" } });
    assert.equal(invalidChannel.statusCode, 400);
  } finally {
    await app.close();
  }
});
