import assert from "node:assert/strict";
import test from "node:test";
import Fastify, { type FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { ChannelDTO } from "../../shared/types.js";
import { registerVirtualDirectChannelRoutes } from "./virtualDirectChannels.js";

async function harness() {
  const writes: unknown[] = [];
  let exists = true;
  const prisma = {
    account: { findUnique: async () => ({ actor: { id: 4 }, displayName: "用户" }) },
    virtualCharacter: { findFirst: async (input: { where: { actor: { username: string } } }) => {
      assert.deepEqual(input.where, { enabled: true, actor: { username: input.where.actor.username, kind: "virtual", status: "active" } });
      return exists ? { actor: { username: input.where.actor.username, displayName: "虚拟角色" } } : null;
    } },
    channel: { upsert: async (input: unknown) => { writes.push(input); return { id: 8 }; } },
    channelMember: { createMany: async (input: unknown) => { writes.push(input); } }
  } as unknown as PrismaClient;
  const app = Fastify();
  registerVirtualDirectChannelRoutes(app, {
    prisma,
    requireAuth: async (request, reply) => {
      if (!request.headers.authorization) return reply.code(401).send({ success: false });
      (request as FastifyRequest & { auth: unknown }).auth = { accountId: 2, isAdmin: false, canPinMessages: false, isGuest: request.headers.authorization === "guest" };
    },
    ensureBuiltIn: async () => null,
    channelDto: async () => ({ id: 8 } as ChannelDTO),
    joined: (accountId, channelId) => { writes.push({ accountId, channelId }); }
  });
  return { app, writes, missing: () => { exists = false; } };
}

test("all enabled virtual roles get an account-owned private channel, including generic roles", async () => {
  const h = await harness();
  try {
    for (const username of ["ai_slmm", "why_assistant", "custom_role"]) {
      const response = await h.app.inject({ method: "POST", url: "/api/direct-virtual-channels", headers: { authorization: "member" }, payload: { username } });
      assert.equal(response.statusCode, 200);
      const upsert = h.writes.at(-3) as { where: { directKey: string }; create: { isPrivate: boolean; members: unknown } };
      assert.equal(upsert.where.directKey, `virtual:2:${username}`);
      assert.equal(upsert.create.isPrivate, true);
      assert.deepEqual(upsert.create.members, { create: [{ accountId: 2, role: "owner" }] });
    }
  } finally { await h.app.close(); }
});

test("unauthenticated, guest, malformed and unavailable recipients cannot create private channels", async () => {
  const h = await harness();
  try {
    for (const [authorization, payload, status] of [[undefined, { username: "ai_slmm" }, 401], ["guest", { username: "ai_slmm" }, 403], ["member", { username: "" }, 400]] as const) {
      const response = await h.app.inject({ method: "POST", url: "/api/direct-virtual-channels", headers: authorization ? { authorization } : {}, payload });
      assert.equal(response.statusCode, status);
    }
    h.missing();
    assert.equal((await h.app.inject({ method: "POST", url: "/api/direct-virtual-channels", headers: { authorization: "member" }, payload: { username: "human_or_disabled" } })).statusCode, 404);
    assert.equal(h.writes.length, 0);
  } finally { await h.app.close(); }
});
