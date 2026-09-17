import assert from "node:assert/strict";
import test from "node:test";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { ChannelDTO, MessageDTO } from "../../shared/types.js";
import { GRACE_CHANNEL_NAME, registerGraceRoutes } from "./grace.js";

type ChannelStub = { id: number; name: string; kind: string; isPrivate: boolean };
type MessageStub = { id: number; channelId: number; type: string; payload: unknown };

function createHarness(options: { canWrite?: boolean; isGuest?: boolean; existingGraceChannel?: boolean } = {}) {
  const accounts = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const channels: ChannelStub[] = options.existingGraceChannel ? [{ id: 55, name: GRACE_CHANNEL_NAME, kind: "standard", isPrivate: false }] : [];
  const sourceMessages: MessageStub[] = [];
  const memberRows: Array<{ accountId: number; channelId: number; role: string }> = [];
  const createdChannels: ChannelStub[] = [];
  let nextChannelId = 100;

  const prisma = {
    channel: {
      findFirst: async ({ where }: { where: { name: string; kind: string } }) =>
        channels.find((channel) => channel.name === where.name && channel.kind === where.kind) || null,
      create: async ({ data }: { data: { name: string; isPrivate: boolean } }) => {
        const channel: ChannelStub = { id: nextChannelId++, name: data.name, kind: "standard", isPrivate: !!data.isPrivate };
        channels.push(channel);
        createdChannels.push(channel);
        return { id: channel.id };
      }
    },
    account: {
      findMany: async () => accounts
    },
    channelMember: {
      createMany: async ({ data }: { data: Array<{ accountId: number; channelId: number; role: string }> }) => {
        memberRows.push(...data);
        return { count: data.length };
      }
    },
    message: {
      findFirst: async ({ where }: { where: { id: number; channelId: number; type: string } }) =>
        sourceMessages.find((message) => message.id === where.id && message.channelId === where.channelId && message.type === where.type) || null
    }
  } as unknown as PrismaClient;

  const createdMessages: Array<{ channelId: number; actorId: number; content?: string; type?: string; payload?: unknown }> = [];
  let nextMessageId = 1000;
  const emissions: Array<{ room: string | null; event: string; payload: unknown }> = [];
  const joinedChannels: Array<{ accountId: number; channelId: number }> = [];
  const io = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        emissions.push({ room, event, payload });
      }
    }),
    emit: (event: string, payload: unknown) => {
      emissions.push({ room: null, event, payload });
    }
  };

  const requireAuth = async (request: FastifyRequest, _reply: FastifyReply) => {
    (request as FastifyRequest & { auth: unknown }).auth = { accountId: 2, actorId: 22, isAdmin: false, isGuest: !!options.isGuest, canPinMessages: false };
  };

  const app = Fastify();
  registerGraceRoutes(app, {
    prisma,
    requireAuth,
    io,
    canAccessChannel: async () => !options.isGuest,
    canWriteChannel: async () => options.canWrite !== false,
    channelDto: async (channelId) => ({ id: channelId, name: GRACE_CHANNEL_NAME }) as ChannelDTO,
    createMessageFromActor: async (input) => {
      createdMessages.push(input);
      return { id: nextMessageId++ };
    },
    hydrateMessage: async (id) => ({ id, channelId: createdChannels[0]?.id || 55 }) as MessageDTO,
    joinAccountChannel: (accountId, channelId) => {
      joinedChannels.push({ accountId, channelId });
    },
    cleanText: (input) => String(input || "").trim().slice(0, 10000)
  });
  return { app, channels, sourceMessages, memberRows, createdChannels, createdMessages, emissions, joinedChannels };
}

test("POST /api/grace creates the grace channel on first use and pulls in every account", async () => {
  const { app, createdChannels, memberRows, joinedChannels, createdMessages, emissions } = createHarness();
  await app.ready();
  try {
    const response = await app.inject({ method: "POST", url: "/api/grace", payload: { content: "今天的恩典" } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().success, true);
    assert.equal(createdChannels.length, 1);
    const channel = createdChannels[0];
    assert.equal(channel.name, GRACE_CHANNEL_NAME);
    assert.equal(channel.isPrivate, false);
    assert.deepEqual(
      memberRows.map((row) => row.accountId).sort(),
      [1, 2, 3]
    );
    assert.ok(memberRows.every((row) => row.channelId === channel.id && row.role === "member"));
    assert.deepEqual(joinedChannels.length, 3);
    assert.equal(createdMessages.length, 1);
    assert.equal(createdMessages[0].channelId, channel.id);
    assert.equal(createdMessages[0].type, "grace");
    assert.deepEqual(createdMessages[0].payload, { kind: "grace" });
    assert.ok(emissions.some((entry) => entry.room === null && entry.event === "channel:updated"));
  } finally {
    await app.close();
  }
});

test("POST /api/grace reuses the channel on later submissions and ignores client channelId", async () => {
  const { app, createdChannels, createdMessages } = createHarness();
  await app.ready();
  try {
    const first = await app.inject({ method: "POST", url: "/api/grace", payload: { content: "第一条" } });
    assert.equal(first.statusCode, 200);
    const second = await app.inject({ method: "POST", url: "/api/grace", payload: { content: "第二条", channelId: 999 } });
    assert.equal(second.statusCode, 200);
    assert.equal(createdChannels.length, 1);
    assert.equal(createdMessages.length, 2);
    assert.equal(createdMessages[1].channelId, createdChannels[0].id);
  } finally {
    await app.close();
  }
});

test("POST /api/grace accepts a voice-only grace entry", async () => {
  const harness = createHarness();
  const { app, createdChannels, sourceMessages, createdMessages } = harness;
  await app.ready();
  try {
    const first = await app.inject({ method: "POST", url: "/api/grace", payload: { content: "占位" } });
    assert.equal(first.statusCode, 200);
    const channelId = createdChannels[0].id;
    sourceMessages.push({ id: 501, channelId, type: "file", payload: { kind: "voice", durationMs: 800 } });
    const response = await app.inject({ method: "POST", url: "/api/grace", payload: { voiceMessageId: 501 } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().success, true);
    assert.deepEqual(createdMessages[1].payload, { kind: "grace", voiceMessageId: 501 });
    assert.equal(createdMessages[1].content, "");
  } finally {
    await app.close();
  }
});

test("POST /api/grace rejects empty submissions and invalid sources", async () => {
  const harness = createHarness();
  const { app, createdChannels, sourceMessages } = harness;
  await app.ready();
  try {
    const empty = await app.inject({ method: "POST", url: "/api/grace", payload: { content: "  " } });
    assert.equal(empty.statusCode, 400);
    const seeded = await app.inject({ method: "POST", url: "/api/grace", payload: { content: "占位" } });
    assert.equal(seeded.statusCode, 200);
    const channelId = createdChannels[0].id;
    sourceMessages.push({ id: 601, channelId, type: "text", payload: null });
    const badVoice = await app.inject({ method: "POST", url: "/api/grace", payload: { voiceMessageId: 601 } });
    assert.equal(badVoice.statusCode, 400);
    const badImage = await app.inject({ method: "POST", url: "/api/grace", payload: { content: "带图", imageMessageId: 601 } });
    assert.equal(badImage.statusCode, 400);
    sourceMessages.push({ id: 602, channelId, type: "image", payload: null });
    const goodImage = await app.inject({ method: "POST", url: "/api/grace", payload: { content: "带图", imageMessageId: 602, effect: "rain" } });
    assert.equal(goodImage.statusCode, 200);
  } finally {
    await app.close();
  }
});

test("POST /api/grace rejects users without write access", async () => {
  const { app, createdMessages } = createHarness({ canWrite: false });
  await app.ready();
  try {
    const response = await app.inject({ method: "POST", url: "/api/grace", payload: { content: "恩典" } });
    assert.equal(response.statusCode, 403);
    assert.equal(createdMessages.length, 0);
  } finally {
    await app.close();
  }
});

test("GET /api/grace/channel returns the channel and blocks guests", async () => {
  const harness = createHarness();
  await harness.app.ready();
  try {
    const response = await harness.app.inject({ method: "GET", url: "/api/grace/channel" });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.success, true);
    assert.equal(body.channel.name, GRACE_CHANNEL_NAME);
    assert.equal(harness.createdChannels.length, 1);
  } finally {
    await harness.app.close();
  }
  const guest = createHarness({ isGuest: true });
  await guest.app.ready();
  try {
    const response = await guest.app.inject({ method: "GET", url: "/api/grace/channel" });
    assert.equal(response.statusCode, 403);
    assert.equal(guest.createdChannels.length, 0);
  } finally {
    await guest.app.close();
  }
});

test("ensureGraceChannel finds an existing grace channel without creating one", async () => {
  const { app, createdChannels, memberRows } = createHarness({ existingGraceChannel: true });
  await app.ready();
  try {
    const response = await app.inject({ method: "GET", url: "/api/grace/channel" });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().channel.id, 55);
    assert.equal(createdChannels.length, 0);
    assert.equal(memberRows.length, 0);
  } finally {
    await app.close();
  }
});
