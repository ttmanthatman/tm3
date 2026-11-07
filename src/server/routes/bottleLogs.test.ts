import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { registerBottleLogRoutes } from "./bottleLogs.js";

function harness() {
  let reads = 0;
  let query: unknown;
  const record = { id: "bottle-id", channelId: 3, text: "<script>私密正文</script>", senderAccountId: 7, readerAccountId: 9, sentAt: "2026-11-07T00:00:00.000Z", openedAt: "2026-11-07T01:00:00.000Z" };
  const prisma = {
    setting: { findMany: async (args: unknown) => { reads++; query = args; return [{ value: JSON.stringify(record) }]; } },
    account: { findMany: async () => [{ id: 7, username: "sender", displayName: "发送人" }, { id: 9, username: "reader", displayName: "拾取人" }] },
    channel: { findMany: async () => [{ id: 3, name: "频道" }] }
  } as unknown as PrismaClient;
  const app = Fastify();
  registerBottleLogRoutes(app, { prisma, requireAdmin: async (request, reply) => {
    if (request.headers["x-admin"] !== "yes") return reply.code(403).send({ success: false });
  } });
  return { app, record, reads: () => reads, query: () => query };
}

test("bottle audit returns linked sender, reader and full text only for administrators", async (t) => {
  const h = harness(); t.after(() => h.app.close());
  const denied = await h.app.inject("/api/admin/bottle-logs");
  assert.equal(denied.statusCode, 403);
  assert.equal(h.reads(), 0);
  const result = await h.app.inject({ url: "/api/admin/bottle-logs?limit=1", headers: { "x-admin": "yes" } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers["cache-control"], "private, no-store");
  assert.deepEqual(result.json().logs, [{ ...h.record, channelName: "频道", senderName: "发送人", senderUsername: "sender", readerName: "拾取人", readerUsername: "reader" }]);
  assert.deepEqual(h.query(), { where: { key: { startsWith: "bottle-log:" } }, orderBy: [{ updatedAt: "desc" }, { key: "desc" }], take: 1 });
});

test("invalid audit limits never read private records", async (t) => {
  const h = harness(); t.after(() => h.app.close());
  for (const limit of ["0", "501", "1.5", "no"]) {
    assert.equal((await h.app.inject({ url: `/api/admin/bottle-logs?limit=${limit}`, headers: { "x-admin": "yes" } })).statusCode, 400);
  }
  assert.equal(h.reads(), 0);
});

test("legacy unknown authors and pending or deleted accounts remain distinguishable", async (t) => {
  const h = harness(); t.after(() => h.app.close());
  Object.assign(h.record, { senderAccountId: null, readerAccountId: 99, sentAt: null });
  let result = await h.app.inject({ url: "/api/admin/bottle-logs", headers: { "x-admin": "yes" } });
  assert.equal(result.json().logs[0].senderName, null);
  assert.equal(result.json().logs[0].readerName, "已删除账号 #99");
  Object.assign(h.record, { readerAccountId: null, openedAt: null });
  result = await h.app.inject({ url: "/api/admin/bottle-logs", headers: { "x-admin": "yes" } });
  assert.equal(result.json().logs[0].readerName, null);
});
