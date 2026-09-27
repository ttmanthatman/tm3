import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import Fastify, { type preHandlerHookHandler } from "fastify";
import { registerMessageSearchRoutes } from "./messageSearch.js";

function harness(account: { isGuest: boolean; guestExpiresAt: Date | null }) {
  let channelWhere: unknown;
  let messageWhere: unknown;
  const channels = [{ id: 4, name: "综合频道" }, { id: 9, name: "私聊" }];
  const prisma = {
    account: { findUnique: async () => account },
    channel: { findMany: async (args: { where: unknown }) => { channelWhere = args.where; return channels; } },
    message: {
      findMany: async (args: { where: unknown }) => {
        messageWhere = args.where;
        return Array.from({ length: 31 }, (_, index) => ({
          id: 100 - index,
          channelId: 9,
          content: "搜索结果",
          createdAt: new Date(Date.UTC(2026, 8, 27, 2, -index)),
          sender: { displayName: "小明" }
        }));
      }
    }
  } as unknown as PrismaClient;
  const app = Fastify();
  const requireAuth: preHandlerHookHandler = async (request) => {
    Object.assign(request, { auth: { accountId: 7 } });
  };
  registerMessageSearchRoutes(app, { prisma, requireAuth });
  return { app, getChannelWhere: () => channelWhere, getMessageWhere: () => messageWhere };
}

test("message search restricts ordinary accounts to accessible channel classes", async () => {
  const route = harness({ isGuest: false, guestExpiresAt: null });
  const response = await route.app.inject({ method: "GET", url: "/api/messages/search?query=咖啡" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(route.getChannelWhere(), {
    kind: { not: "aiLounge" },
    OR: [
      { kind: "music" },
      { isPrivate: false, directKey: null },
      { members: { some: { accountId: 7 } } }
    ]
  });
  assert.deepEqual((route.getMessageWhere() as { channelId: unknown }).channelId, { in: [4, 9] });
  assert.deepEqual((route.getMessageWhere() as { content: unknown }).content, { contains: "咖啡" });
  const body = response.json();
  assert.equal(body.results.length, 30);
  assert.equal(body.results[0].channelName, "私聊");
  assert.equal(body.results[0].senderName, "小明");
  assert.deepEqual(body.nextCursor, { id: 71, createdAt: "2026-09-27T01:31:00.000Z" });
  await route.app.close();
});

test("message search limits guests to their active reception channels", async () => {
  const route = harness({ isGuest: true, guestExpiresAt: new Date(Date.now() + 60_000) });
  await route.app.inject({ method: "GET", url: "/api/messages/search?query=咖啡" });
  const where = route.getChannelWhere() as { kind: string; receptionExpiresAt: { gt: Date }; members: unknown };
  assert.equal(where.kind, "reception");
  assert.ok(where.receptionExpiresAt.gt instanceof Date);
  assert.deepEqual(where.members, { some: { accountId: 7 } });
  await route.app.close();
});

test("message search rejects empty queries and ignores expired guest accounts", async () => {
  const route = harness({ isGuest: true, guestExpiresAt: new Date(Date.now() - 60_000) });
  const empty = await route.app.inject({ method: "GET", url: "/api/messages/search?query=%20%20" });
  assert.equal(empty.statusCode, 400);
  const expired = await route.app.inject({ method: "GET", url: "/api/messages/search?query=咖啡" });
  assert.deepEqual(expired.json(), { results: [], nextCursor: null });
  assert.equal(route.getChannelWhere(), undefined);
  await route.app.close();
});
