import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import Fastify, { type FastifyRequest } from "fastify";
import type { ChannelDTO } from "../../shared/types.js";
import { readReceptionInviteToken } from "../receptionInvites.js";
import { normalizeReceptionCode, receptionCodeHash, registerReceptionRoutes, roomSchema, roomUpdateSchema } from "./reception.js";

const routeSecret = "route-test-secret-that-is-long-enough-for-invitations";

function createRouteHarness() {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const room = {
    id: 77,
    kind: "reception" as const,
    name: "临时会客厅",
    description: "邀请制会客厅",
    icon: "",
    listColor: null,
    isPrivate: true,
    isDefault: false,
    directKey: null,
    receptionOwnerAccountId: 1,
    receptionTokenHash: receptionCodeHash("平安", routeSecret),
    receptionExpiresAt: expiresAt,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const state = {
    createData: null as Record<string, unknown> | null,
    guestCreateData: null as Record<string, unknown> | null
  };
  const prisma = {
    actor: { findUnique: async () => ({ id: 11 }) },
    account: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.guestCreateData = data;
        return {
          id: 99,
          username: data.username,
          passwordHash: data.passwordHash,
          displayName: data.displayName,
          role: "user",
          isGuest: true,
          guestExpiresAt: data.guestExpiresAt,
          theme: "wechat",
          biblePreferences: null,
          canPinMessages: false,
          lastLoginAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          actor: { id: 199, kind: "human", username: data.username, displayName: data.displayName }
        };
      }
    },
    channel: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.createData = data;
        return room;
      },
      findFirst: async () => room
    }
  } as unknown as PrismaClient;
  const app = Fastify();
  const channelDto: ChannelDTO = {
    id: room.id,
    name: room.name,
    description: room.description,
    icon: room.icon,
    kind: room.kind,
    isPrivate: true,
    isDefault: false,
    receptionExpiresAt: expiresAt.toISOString(),
    canManage: true,
    memberCount: 1,
    lastMessageId: 1
  };
  registerReceptionRoutes(app, {
    prisma,
    tokenSecret: routeSecret,
    inviteOrigin: "https://visit.example.com",
    requireAuth: async (request) => {
      (request as FastifyRequest & { auth: { accountId: number; isAdmin: boolean; isGuest: boolean } }).auth = {
        accountId: 1,
        isAdmin: false,
        isGuest: false
      };
    },
    requireAdmin: async () => undefined,
    authFor: (request) => (request as FastifyRequest & { auth: { accountId: number; isAdmin: boolean; isGuest: boolean } }).auth,
    createAuthSession: async () => ({ id: "unused" }) as never,
    signToken: () => "unused",
    authDto: () => ({}) as never,
    channelDto: async () => channelDto,
    joinAccountChannel: () => undefined,
    emitRoomUpdated: async () => undefined,
    deleteRoom: async () => true
  });
  return { app, state, room };
}

test("reception codes accept simple words and six digit numbers", () => {
  assert.equal(normalizeReceptionCode(" Grace "), "grace");
  assert.equal(normalizeReceptionCode("平安"), "平安");
  assert.equal(normalizeReceptionCode("123456"), "123456");
});

test("reception room create and update inputs accept two-character Chinese codes", () => {
  assert.equal(roomSchema.parse({ name: "在家教育", code: "鹧鸪", durationHours: 24 }).code, "鹧鸪");
  assert.equal(roomUpdateSchema.parse({ code: "鹧鸪" }).code, "鹧鸪");
});

test("reception rooms accept a validated channel-list color", () => {
  assert.equal(roomSchema.parse({ name: "会客厅", code: "平安", durationHours: 24, listColor: "#AABBCC" }).listColor, "#AABBCC");
  assert.equal(roomUpdateSchema.parse({ listColor: null }).listColor, null);
  assert.throws(() => roomUpdateSchema.parse({ listColor: "red" }));
});

test("reception codes reject short or ambiguous input", () => {
  assert.throws(() => normalizeReceptionCode("a"), /至少需要 2 个字/);
  assert.throws(() => normalizeReceptionCode("12345"), /至少需要 6 位/);
  assert.throws(() => normalizeReceptionCode("hello-world"), /文字或数字/);
});

test("reception codes are stored as stable keyed hashes", () => {
  const hash = receptionCodeHash("Grace", "secret-a");
  assert.equal(hash, receptionCodeHash(" grace ", "secret-a"));
  assert.notEqual(hash, receptionCodeHash("grace", "secret-b"));
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash.includes("grace"), false);
});

test("creating a reception room persists its welcome notice as a system message", async (context) => {
  const { app, state } = createRouteHarness();
  context.after(() => app.close());
  const response = await app.inject({
    method: "POST",
    url: "/api/reception/rooms",
    payload: { name: "临时会客厅", code: "平安", durationHours: 24 }
  });
  assert.equal(response.statusCode, 200);
  const messages = state.createData?.messages as { create: Array<{ type: string; content: string }> };
  assert.equal(messages.create[0].type, "system");
  assert.match(messages.create[0].content, /有效期为 1 天/);
  assert.match(messages.create[0].content, /加密连接/);
  assert.match(messages.create[0].content, /令牌会立即失效/);
  assert.match(messages.create[0].content, /自动销毁/);
});

test("room owners can create an opaque invitation URL bound to the room", async (context) => {
  const { app, room } = createRouteHarness();
  context.after(() => app.close());
  const response = await app.inject({ method: "POST", url: `/api/reception/rooms/${room.id}/invitation` });
  assert.equal(response.statusCode, 200);
  const body = response.json() as { invitePath: string; inviteUrl: string };
  assert.match(body.invitePath, /^\/visit\/[A-Za-z0-9_-]+$/);
  assert.equal(body.inviteUrl, `https://visit.example.com${body.invitePath}`);
  const payload = readReceptionInviteToken(body.invitePath.slice("/visit/".length), routeSecret);
  assert.equal(payload.roomId, room.id);
  assert.equal(payload.expiresAt, room.receptionExpiresAt.getTime());
  assert.equal(payload.tokenHash, room.receptionTokenHash);
});

test("guests can join through a current invitation token without receiving the room code", async (context) => {
  const { app, room, state } = createRouteHarness();
  context.after(() => app.close());
  const invitation = await app.inject({ method: "POST", url: `/api/reception/rooms/${room.id}/invitation` });
  const { invitePath } = invitation.json() as { invitePath: string };
  const response = await app.inject({
    method: "POST",
    url: "/api/reception/join",
    payload: { inviteToken: invitePath.slice("/visit/".length), displayName: "来访者" }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(state.guestCreateData?.displayName, "来访者");
  assert.equal(state.guestCreateData?.guestExpiresAt, room.receptionExpiresAt);
  assert.deepEqual(state.guestCreateData?.memberships, { create: [{ channelId: room.id, role: "member" }] });
  assert.equal("code" in (state.guestCreateData || {}), false);
});
