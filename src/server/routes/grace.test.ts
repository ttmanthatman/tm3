import assert from "node:assert/strict";
import test from "node:test";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { MessageDTO } from "../../shared/types.js";
import { registerGraceRoutes } from "./grace.js";

type SourceMessage = { id: number; channelId: number; type: string; payload: unknown };
type GraceRow = {
  id: number;
  channelId: number;
  senderActorId: number;
  createdAt: Date;
  channel: { id: number; name: string };
  favorites: Array<{ id: number; createdAt: Date }>;
};

function message(id: number, channelId: number, senderId = 22): MessageDTO {
  return {
    id,
    channelId,
    sender: { id: senderId, kind: "human", username: "reader", displayName: "读者" },
    content: "今天的恩典",
    type: "grace",
    payload: { kind: "grace" },
    createdAt: "2026-09-17T08:00:00.000Z"
  };
}

function createHarness(options: { canWrite?: boolean; canAccess?: (channelId: number) => boolean } = {}) {
  const sourceMessages: SourceMessage[] = [];
  const graceRows: GraceRow[] = [];
  const hydrated = new Map<number, MessageDTO>();
  const prisma = {
    message: {
      findFirst: async ({ where }: { where: { id: number; channelId: number; type: string } }) =>
        sourceMessages.find((row) => row.id === where.id && row.channelId === where.channelId && row.type === where.type) || null,
      findMany: async () => graceRows
    }
  } as unknown as PrismaClient;
  const createdMessages: Array<{ channelId: number; actorId: number; content?: string; type?: string; payload?: unknown; pushOrigin?: string }> = [];
  let nextMessageId = 1000;
  const requireAuth = async (request: FastifyRequest, _reply: FastifyReply) => {
    (request as FastifyRequest & { auth: unknown }).auth = {
      accountId: 2,
      actorId: 22,
      isAdmin: false,
      isGuest: false,
      canPinMessages: false
    };
  };
  const app = Fastify();
  registerGraceRoutes(app, {
    prisma,
    requireAuth,
    canAccessChannel: async (_accountId, channelId) => options.canAccess ? options.canAccess(channelId) : true,
    canWriteChannel: async () => options.canWrite !== false,
    createMessageFromActor: async (input) => {
      createdMessages.push(input);
      const id = nextMessageId++;
      hydrated.set(id, message(id, input.channelId));
      return { id };
    },
    hydrateMessage: async (id) => hydrated.get(id) || null,
    cleanText: (input) => String(input || "").trim().slice(0, 10000)
  });
  return { app, sourceMessages, graceRows, hydrated, createdMessages };
}

test("POST /api/grace sends a grace card into the selected channel", async () => {
  const { app, createdMessages } = createHarness();
  await app.ready();
  try {
    const response = await app.inject({ method: "POST", url: "/api/grace", payload: { channelId: 7, content: "今天的恩典" } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().message.channelId, 7);
    assert.equal(createdMessages.length, 1);
    assert.deepEqual(
      { ...createdMessages[0], pushOrigin: undefined },
      { channelId: 7, actorId: 22, content: "今天的恩典", type: "grace", payload: { kind: "grace" }, pushOrigin: undefined }
    );
  } finally {
    await app.close();
  }
});

test("POST /api/grace accepts voice-only cards and validates attachments in the same channel", async () => {
  const { app, sourceMessages, createdMessages } = createHarness();
  sourceMessages.push(
    { id: 501, channelId: 7, type: "file", payload: { kind: "voice", durationMs: 800 } },
    { id: 502, channelId: 7, type: "image", payload: null },
    { id: 503, channelId: 8, type: "image", payload: null }
  );
  await app.ready();
  try {
    const good = await app.inject({ method: "POST", url: "/api/grace", payload: { channelId: 7, voiceMessageId: 501, imageMessageId: 502 } });
    assert.equal(good.statusCode, 200);
    assert.deepEqual(createdMessages[0].payload, { kind: "grace", voiceMessageId: 501, imageMessageId: 502 });
    const wrongChannel = await app.inject({ method: "POST", url: "/api/grace", payload: { channelId: 7, content: "带图", imageMessageId: 503 } });
    assert.equal(wrongChannel.statusCode, 400);
  } finally {
    await app.close();
  }
});

test("POST /api/grace rejects empty cards and channels without write access", async () => {
  const writable = createHarness();
  await writable.app.ready();
  try {
    const empty = await writable.app.inject({ method: "POST", url: "/api/grace", payload: { channelId: 7, content: "  " } });
    assert.equal(empty.statusCode, 400);
  } finally {
    await writable.app.close();
  }
  const readonly = createHarness({ canWrite: false });
  await readonly.app.ready();
  try {
    const denied = await readonly.app.inject({ method: "POST", url: "/api/grace", payload: { channelId: 7, content: "恩典" } });
    assert.equal(denied.statusCode, 403);
    assert.equal(readonly.createdMessages.length, 0);
  } finally {
    await readonly.app.close();
  }
});

test("GET /api/grace/favorites returns accessible own and explicitly favorited grace cards", async () => {
  const { app, graceRows, hydrated } = createHarness({ canAccess: (channelId) => channelId !== 9 });
  const ownCreatedAt = new Date("2026-09-17T08:00:00.000Z");
  const savedAt = new Date("2026-09-17T09:00:00.000Z");
  graceRows.push(
    { id: 11, channelId: 7, senderActorId: 22, createdAt: ownCreatedAt, channel: { id: 7, name: "团契" }, favorites: [] },
    { id: 12, channelId: 8, senderActorId: 44, createdAt: ownCreatedAt, channel: { id: 8, name: "分享" }, favorites: [{ id: 91, createdAt: savedAt }] },
    { id: 13, channelId: 9, senderActorId: 22, createdAt: ownCreatedAt, channel: { id: 9, name: "无权访问" }, favorites: [] }
  );
  hydrated.set(11, message(11, 7));
  hydrated.set(12, message(12, 8, 44));
  hydrated.set(13, message(13, 9));
  await app.ready();
  try {
    const response = await app.inject({ method: "GET", url: "/api/grace/favorites" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().favorites.map((row: { id: number; own: boolean; favorited: boolean }) => ({ id: row.id, own: row.own, favorited: row.favorited })), [
      { id: 11, own: true, favorited: false },
      { id: 12, own: false, favorited: true }
    ]);
    assert.equal(response.json().favorites[1].savedAt, savedAt.toISOString());
  } finally {
    await app.close();
  }
});
