import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { ZodError } from "zod";
import type { NotificationRead } from "../../shared/notificationRead.js";
import { registerNotificationsRoutes } from "./notifications.js";

async function fixture(allowed = true, persistFails = false) {
  const saved = new Map<string, string>();
  const broadcasts: { accountId: number; read: NotificationRead }[] = [];
  const prisma = {
    setting: {
      findMany: async ({ where }: { where: { key: { startsWith: string } } }) => [...saved.keys()].filter((key) => key.startsWith(where.key.startsWith)).map((key) => ({ key })),
      upsert: ({ create }: { create: { key: string; value: string } }) => Promise.resolve(create)
    },
    message: { findMany: async ({ where }: { where: { id: { in: number[] } } }) => where.id.in.map((id) => ({ id, channelId: 3 })) },
    $transaction: async (writes: Promise<{ key: string; value: string }>[]) => {
      if (persistFails) throw new Error("database unavailable");
      const rows = await Promise.all(writes);
      for (const row of rows) saved.set(row.key, row.value);
    }
  } as unknown as PrismaClient;
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof ZodError ? 400 : 500).send({ success: false }));
  registerNotificationsRoutes(app, {
    prisma,
    requireAuth: async (request, reply) => {
      const accountId = Number(request.headers["x-test-account"]);
      if (!accountId) return reply.code(401).send({ success: false });
      Object.assign(request, { auth: { accountId } });
    },
    pushNotificationsEnabled: false, vapidPublicKey: () => "", pushReady: () => false,
    canAccessChannel: async () => allowed,
    notifyRead: (accountId, read) => broadcasts.push({ accountId, read })
  });
  return { app, saved, broadcasts };
}

test("mention reads persist individually, are idempotent and account scoped", async () => {
  const { app, saved, broadcasts } = await fixture();
  try {
    for (const ids of [[100, 101], [100, 102]]) {
      const result = await app.inject({ method: "PATCH", url: "/api/notifications/mentions/read", headers: { "x-test-account": "1" }, payload: { ids } });
      assert.equal(result.statusCode, 200);
    }
    assert.equal(saved.size, 3);
    const own = await app.inject({ method: "GET", url: "/api/notifications/mentions/read", headers: { "x-test-account": "1" } });
    assert.deepEqual(own.json(), { ids: [100, 101, 102] });
    const other = await app.inject({ method: "GET", url: "/api/notifications/mentions/read", headers: { "x-test-account": "2" } });
    assert.deepEqual(other.json(), { ids: [] });
    assert.ok(broadcasts.every((event) => event.accountId === 1));
  } finally { await app.close(); }
});

test("unauthenticated, invalid and inaccessible mention writes persist nothing", async () => {
  const { app, saved, broadcasts } = await fixture(false);
  try {
    assert.equal((await app.inject({ method: "GET", url: "/api/notifications/mentions/read" })).statusCode, 401);
    for (const ids of [[], [-1], [1.5], ["1"], Array(501).fill(1)]) {
      assert.equal((await app.inject({ method: "PATCH", url: "/api/notifications/mentions/read", headers: { "x-test-account": "1" }, payload: { ids } })).statusCode, 400);
    }
    assert.equal((await app.inject({ method: "PATCH", url: "/api/notifications/mentions/read", headers: { "x-test-account": "1" }, payload: { ids: [1] } })).statusCode, 403);
    assert.equal(saved.size, 0);
    assert.deepEqual(broadcasts, []);
  } finally { await app.close(); }
});

test("a failed persistence cannot broadcast a successful read", async () => {
  const { app, saved, broadcasts } = await fixture(true, true);
  try {
    assert.equal((await app.inject({ method: "PATCH", url: "/api/notifications/mentions/read", headers: { "x-test-account": "1" }, payload: { ids: [1] } })).statusCode, 500);
    assert.equal(saved.size, 0);
    assert.deepEqual(broadcasts, []);
  } finally { await app.close(); }
});
