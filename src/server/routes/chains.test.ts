import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { registerChainRoutes } from "./chains.js";

function harness(auth: { accountId: number; actorId: number; isAdmin: boolean }) {
  const refreshed: number[] = [];
  const rows = [
    { id: 10, channelId: 3, senderActorId: 4, content: "聚餐报名", type: "chain", payload: { topic: "聚餐报名", participants: [] }, chainRootId: 10, sender: { accountId: 7 } },
    { id: 11, channelId: 3, senderActorId: 5, content: "聚餐报名", type: "chain", payload: { topic: "聚餐报名", participants: [{ actorId: 5, name: "成员", text: "", at: "now" }] }, chainRootId: 10 }
  ];
  const prisma = {
    message: {
      findFirst: async () => rows[0],
      findMany: async () => rows,
      update: ({ where, data }: { where: { id: number }; data: { payload: unknown } }) => Promise.resolve(Object.assign(rows.find((row) => row.id === where.id)!, data))
    },
    actor: { findUnique: async () => ({ displayName: auth.isAdmin ? "管理员" : "发起人" }) },
    $transaction: async (updates: Array<Promise<unknown>>) => Promise.all(updates)
  } as unknown as PrismaClient;
  const app = Fastify();
  registerChainRoutes(app, {
    prisma,
    requireAuth: async (request) => Object.assign(request, { auth }),
    canAccessChannel: async () => true,
    refreshChannel: (channelId) => refreshed.push(channelId)
  });
  return { app, rows, refreshed };
}

test("the chain owner ends every stored version", async (context) => {
  const { app, rows, refreshed } = harness({ accountId: 7, actorId: 4, isAdmin: false });
  context.after(() => app.close());
  const response = await app.inject({ method: "POST", url: "/api/chains/10/end" });
  assert.equal(response.statusCode, 200);
  assert.equal((rows[0].payload as { ended?: { byName: string } }).ended?.byName, "发起人");
  assert.equal((rows[1].payload as { ended?: { byActorId: number } }).ended?.byActorId, 4);
  assert.deepEqual(refreshed, [3]);
});

test("a regular participant cannot end another person's chain", async (context) => {
  const { app, rows, refreshed } = harness({ accountId: 9, actorId: 5, isAdmin: false });
  context.after(() => app.close());
  const response = await app.inject({ method: "POST", url: "/api/chains/10/end" });
  assert.equal(response.statusCode, 403);
  assert.equal((rows[0].payload as { ended?: unknown }).ended, undefined);
  assert.deepEqual(refreshed, []);
});

test("an administrator can end another person's chain", async (context) => {
  const { app } = harness({ accountId: 1, actorId: 1, isAdmin: true });
  context.after(() => app.close());
  const response = await app.inject({ method: "POST", url: "/api/chains/10/end" });
  assert.equal(response.statusCode, 200);
});
