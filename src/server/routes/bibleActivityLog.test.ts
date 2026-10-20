import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import Fastify, { type FastifyRequest } from "fastify";
import { registerBibleActivityLogRoutes } from "./bibleActivityLog.js";

test("打开圣经事件进入内存日志并可从 /log 页面读取", async () => {
  const app = Fastify();
  type Reply = { sent: boolean; code: (status: number) => { send: (body: unknown) => unknown } };
  const requireAuth = async (request: FastifyRequest, _reply: Reply) => {
    (request as { auth?: unknown }).auth = { accountId: 7, isAdmin: false };
  };
  const prisma = {
    account: {
      findUnique: async () => ({ username: "probe", displayName: "探针成员" })
    }
  };
  registerBibleActivityLogRoutes(app, { prisma: prisma as unknown as PrismaClient, requireAuth: requireAuth as never });

  const rejected = await app.inject({ method: "POST", url: "/api/bible/activity", payload: { action: "nope" } });
  assert.equal(rejected.statusCode, 400);

  const accepted = await app.inject({ method: "POST", url: "/api/bible/activity", payload: { action: "open" } });
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.json().success, true);

  const page = await app.inject({ method: "GET", url: "/log" });
  assert.equal(page.statusCode, 200);
  assert.match(page.headers["content-type"] as string, /text\/html/);
  assert.match(page.body, /打开圣经/);
  assert.match(page.body, /探针成员/);
  assert.match(String(page.headers["cache-control"]), /no-store/);
});
