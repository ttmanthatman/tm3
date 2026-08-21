import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { parseLastReadMap, registerUnreadCountsRoutes, resolveReadPositions } from "./unreadCounts.js";

test("parseLastReadMap accepts a plain channel-to-message id map", () => {
  assert.deepEqual(parseLastReadMap('{"3":123,"5":0}'), { 3: 123, 5: 0 });
});

test("parseLastReadMap drops malformed keys and values", () => {
  assert.deepEqual(parseLastReadMap('{"0":5,"abc":9,"4":"12","6":-3,"7":1.9}'), { 4: 12, 7: 1 });
});

test("parseLastReadMap treats invalid JSON and non-objects as empty", () => {
  assert.deepEqual(parseLastReadMap("not-json"), {});
  assert.deepEqual(parseLastReadMap("[1,2]"), {});
  assert.deepEqual(parseLastReadMap("null"), {});
  assert.deepEqual(parseLastReadMap(""), {});
});

test("resolveReadPositions prefers account state, accepts newer local migration hints, and clamps to the channel", () => {
  const positions = resolveReadPositions(
    [1, 2, 3],
    new Map([[1, 100], [2, 80], [3, 40]]),
    new Map([[1, 70], [2, 60]]),
    { 1: 90, 2: 999 }
  );
  assert.deepEqual(positions, { 1: 90, 2: 80, 3: 40 });
});

test("resolveReadPositions never regresses a stored account read position", () => {
  const positions = resolveReadPositions([7], new Map([[7, 200]]), new Map([[7, 150]]), { 7: 120 });
  assert.deepEqual(positions, { 7: 150 });
});

test("mark-read route keeps the account position monotonic and broadcasts it to sibling devices", async (context) => {
  let storedPosition = 80;
  const emitted: Array<{ accountId: number; event: { channelId: number; lastReadMessageId: number; unreadCount: number } }> = [];
  const channelRead = {
    createMany: async () => ({ count: 0 }),
    updateMany: async ({ where }: { where: { lastReadMessageId: { lt: number } } }) => {
      if (storedPosition < where.lastReadMessageId.lt) storedPosition = where.lastReadMessageId.lt;
      return { count: 1 };
    },
    findUnique: async () => ({ lastReadMessageId: storedPosition })
  };
  const prisma = {
    channel: { findFirst: async () => ({ id: 3 }) },
    channelRead,
    message: {
      aggregate: async () => ({ _max: { id: 120 } }),
      count: async () => 2
    },
    $transaction: async (callback: (tx: { channelRead: typeof channelRead }) => Promise<void>) => callback({ channelRead })
  } as unknown as PrismaClient;
  const app = Fastify();
  context.after(() => app.close());
  registerUnreadCountsRoutes(app, {
    prisma,
    channelListWhere: () => ({}),
    requireAuth: async (request) => {
      Object.assign(request, { auth: { accountId: 9, actorId: 19, username: "reader", isAdmin: false, isGuest: false, canPinMessages: false, sessionId: "session" } });
    },
    emitRead: (accountId, event) => emitted.push({ accountId, event })
  });

  const advanced = await app.inject({ method: "PUT", url: "/api/channels/3/read", payload: { lastReadMessageId: 100 } });
  assert.equal(advanced.statusCode, 200);
  assert.deepEqual(advanced.json(), { channelId: 3, lastReadMessageId: 100, unreadCount: 2 });
  const staleDevice = await app.inject({ method: "PUT", url: "/api/channels/3/read", payload: { lastReadMessageId: 70 } });
  assert.deepEqual(staleDevice.json(), { channelId: 3, lastReadMessageId: 100, unreadCount: 2 });
  assert.equal(storedPosition, 100);
  assert.deepEqual(emitted.at(-1), { accountId: 9, event: { channelId: 3, lastReadMessageId: 100, unreadCount: 2 } });
});
