import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import Fastify, { type FastifyRequest } from "fastify";
import { registerChannelOwnershipRoutes } from "./channelOwnership.js";

type MembershipRole = "owner" | "admin" | "member";

function createHarness(options: {
  accountId?: number;
  channel?: { kind: string; isPrivate: boolean; isDefault: boolean; directKey: string | null } | null;
  memberships?: Record<number, MembershipRole>;
} = {}) {
  const accountId = options.accountId ?? 1;
  const channel = options.channel === undefined
    ? { kind: "standard", isPrivate: true, isDefault: false, directKey: null }
    : options.channel;
  const memberships = new Map<number, MembershipRole>(
    Object.entries(options.memberships ?? { 1: "owner", 2: "member" }).map(([id, role]) => [Number(id), role as MembershipRole])
  );
  const events: string[] = [];
  const notices: Array<{ content: string; payload: unknown }> = [];
  const channelMember = {
    findUnique: async ({ where }: { where: { channelId_accountId: { accountId: number } } }) => {
      const role = memberships.get(where.channelId_accountId.accountId);
      return role
        ? { role, account: { displayName: `成员${where.channelId_accountId.accountId}`, actor: { id: 100 + where.channelId_accountId.accountId } } }
        : null;
    },
    updateMany: async ({ where, data }: { where: { accountId: number }; data: { role: MembershipRole } }) => {
      const targetId = where.accountId;
      if (!memberships.has(targetId)) return { count: 0 };
      memberships.set(targetId, data.role);
      return { count: 1 };
    },
    deleteMany: async ({ where }: { where: { accountId: number; role?: MembershipRole } }) => {
      if (!memberships.has(where.accountId) || (where.role && memberships.get(where.accountId) !== where.role)) return { count: 0 };
      memberships.delete(where.accountId);
      return { count: 1 };
    }
  };
  const message = {
    create: async ({ data }: { data: { content: string; payload: unknown } }) => {
      notices.push({ content: data.content, payload: data.payload });
      return { id: 501 };
    }
  };
  const prisma = {
    channel: { findUnique: async () => channel },
    channelMember,
    $transaction: async (callback: (tx: { channelMember: typeof channelMember; message: typeof message }) => Promise<void>) => callback({ channelMember, message })
  } as unknown as PrismaClient;
  const app = Fastify();
  registerChannelOwnershipRoutes(app, {
    prisma,
    requireAuth: async (request) => {
      (request as FastifyRequest & { auth: { accountId: number } }).auth = { accountId };
    },
    authFor: (request) => (request as FastifyRequest & { auth: { accountId: number } }).auth,
    leaveAccountChannel: (leavingAccountId, channelId) => events.push(`leave:${leavingAccountId}:${channelId}`),
    emitMemberLeft: async (channelId, previousOwnerId, nextOwnerId) => {
      events.push(`changed:${channelId}:${previousOwnerId}:${nextOwnerId ?? "none"}`);
    },
    emitSystemMessage: async (messageId) => {
      events.push(`notice:${messageId}`);
    }
  });
  return { app, memberships, events, notices };
}

test("an ordinary member can leave and the remaining channel gets a persistent system notice", async (context) => {
  const { app, memberships, events, notices } = createHarness({ memberships: { 1: "member", 2: "owner" } });
  context.after(() => app.close());

  const response = await app.inject({ method: "POST", url: "/api/channels/7/leave", payload: {} });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { success: true, channelId: 7, successorAccountId: null });
  assert.equal(memberships.has(1), false);
  assert.deepEqual(notices, [
    {
      content: "成员1 退出了频道",
      payload: { systemKind: "channel-membership", action: "left", accountId: 1 }
    }
  ]);
  assert.deepEqual(events, ["leave:1:7", "notice:501", "changed:7:1:none"]);
});

test("a private standard channel owner can atomically transfer ownership and leave", async (context) => {
  const { app, memberships, events, notices } = createHarness();
  context.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/channels/7/leave",
    payload: { successorAccountId: 2 }
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { success: true, channelId: 7, successorAccountId: 2 });
  assert.equal(memberships.has(1), false);
  assert.equal(memberships.get(2), "owner");
  assert.equal(notices[0]?.content, "成员1 退出了频道");
  assert.deepEqual(events, ["leave:1:7", "notice:501", "changed:7:1:2"]);
});

test("an owner must select a successor before leaving", async (context) => {
  const { app, memberships, events, notices } = createHarness();
  context.after(() => app.close());

  const response = await app.inject({ method: "POST", url: "/api/channels/7/leave", payload: {} });

  assert.equal(response.statusCode, 400);
  assert.equal(memberships.get(1), "owner");
  assert.deepEqual(events, []);
  assert.deepEqual(notices, []);
});

test("only the current channel owner can transfer ownership", async (context) => {
  const { app, memberships, events } = createHarness({ memberships: { 1: "member", 2: "member" } });
  context.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/channels/7/transfer-and-leave",
    payload: { successorAccountId: 2 }
  });

  assert.equal(response.statusCode, 403);
  assert.equal(memberships.get(1), "member");
  assert.equal(memberships.get(2), "member");
  assert.deepEqual(events, []);
});

test("the successor must already be another human member of the channel", async (context) => {
  const { app, memberships } = createHarness({ memberships: { 1: "owner" } });
  context.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/channels/7/transfer-and-leave",
    payload: { successorAccountId: 2 }
  });

  assert.equal(response.statusCode, 404);
  assert.equal(memberships.get(1), "owner");
});

test("public and system channels cannot use ownership transfer as a leave mechanism", async (context) => {
  const { app, memberships } = createHarness({
    channel: { kind: "standard", isPrivate: false, isDefault: false, directKey: null }
  });
  context.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/channels/7/transfer-and-leave",
    payload: { successorAccountId: 2 }
  });

  assert.equal(response.statusCode, 400);
  assert.equal(memberships.get(1), "owner");
  assert.equal(memberships.get(2), "member");
});
