import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import multipart from "@fastify/multipart";
import sharp from "sharp";
import type { GraceStoryInput } from "../services/stories.js";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { MessageDTO } from "../../shared/types.js";
import { registerGraceRoutes } from "./grace.js";

type SourceMessage = {
  id: number;
  channelId: number;
  type: string;
  payload: unknown;
  senderActorId?: number;
  content?: string;
  createdAt?: Date;
  filePath?: string | null;
  sender?: { accountId: number };
};
type GraceRow = {
  id: number;
  channelId: number;
  senderActorId: number;
  payload: unknown;
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

function createHarness(options: { canWrite?: boolean; canAccess?: (channelId: number) => boolean; storyFails?: boolean; isGuest?: boolean } = {}) {
  const sourceMessages: SourceMessage[] = [];
  const graceRows: GraceRow[] = [];
  const hydrated = new Map<number, MessageDTO>();
  const actions: Array<{ messageId: number; accountId: number }> = [];
  const updates: Array<{ id: number; data: Record<string, unknown> }> = [];
  const deleted: number[] = [];
  const emitted: Array<{ room: string; event: string }> = [];
  const createdStories: GraceStoryInput[] = [];
  const prisma = {
    message: {
      findFirst: async ({ where }: { where: { id: number; channelId: number; type: string } }) =>
        sourceMessages.find((row) => row.id === where.id && row.channelId === where.channelId && row.type === where.type) || null,
      findMany: async () => graceRows,
      findUnique: async ({ where }: { where: { id: number } }) => sourceMessages.find((row) => row.id === where.id) || null,
      update: async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        updates.push({ id: where.id, data });
        const row = sourceMessages.find((message) => message.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      }
    },
    actor: {
      findUnique: async () => ({ id: 22, accountId: 2, username: "reader" })
    },
    prayerAction: {
      create: async ({ data }: { data: { messageId: number; accountId: number } }) => {
        actions.push(data);
        return { id: actions.length, ...data };
      }
    }
  } as unknown as PrismaClient;
  const createdMessages: Array<{ channelId: number; actorId: number; content?: string; type?: string; payload?: unknown; pushOrigin?: string }> = [];
  let nextMessageId = 1000;
  const requireAuth = async (request: FastifyRequest, _reply: FastifyReply) => {
    (request as FastifyRequest & { auth: unknown }).auth = {
      accountId: 2,
      actorId: 22,
      username: "reader",
      isAdmin: false,
      isGuest: options.isGuest === true,
      canPinMessages: false
    };
  };
  const app = Fastify();
  app.register(multipart);
  const uploadDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "grace-route-test-"));
  app.addHook("onClose", async () => { fs.rmSync(uploadDirectory, { recursive: true, force: true }); });
  registerGraceRoutes(app, {
    prisma,
    requireAuth,
    requireMediaAuth: requireAuth,
    uploadDirectory,
    canAccessChannel: async (_accountId, channelId) => options.canAccess ? options.canAccess(channelId) : true,
    canWriteChannel: async () => options.canWrite !== false,
    saveGrace: async (input, pushOrigin) => {
      if (options.storyFails) throw new Error("story sync failed");
      const id = nextMessageId++;
      const payload = input.source ? { ...input.payload, sourceGraceMessageId: input.source.id } : input.payload;
      createdMessages.push({ channelId: input.channelId, actorId: input.actorId, content: input.content, type: "grace", payload, pushOrigin });
      hydrated.set(id, { ...message(id, input.channelId), content: input.content, payload });
      if (input.story) createdStories.push({ ...input.story, graceMessageId: id });
      if (input.source) {
        updates.push({ id: input.source.id, data: { content: input.content, payload: input.payload } });
        const row = sourceMessages.find((message) => message.id === input.source?.id);
        if (row) Object.assign(row, { content: input.content, payload: input.payload });
      }
      return { id };
    },
    hydrateMessage: async (id) => hydrated.get(id) || null,
    deleteMessages: async (messages) => {
      deleted.push(...messages.map((row) => row.id));
      return messages.length;
    },
    io: {
      to: (room) => ({ emit: (event) => emitted.push({ room, event }) })
    },
    cleanText: (input) => String(input || "").trim().slice(0, 10000)
  });
  return { app, sourceMessages, graceRows, hydrated, createdMessages, createdStories, actions, updates, deleted, emitted, uploadDirectory };
}

test("POST /api/grace sends a grace card and creates an independent story", async () => {
  const { app, createdMessages, createdStories } = createHarness();
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
    assert.deepEqual(createdStories, [{ accountId: 2, graceMessageId: 1000, content: "今天的恩典", voiceMessageId: undefined, imageMessageId: undefined }]);
  } finally {
    await app.close();
  }
});

test("POST /api/grace keeps guest reception cards without creating inaccessible stories", async () => {
  const { app, createdMessages, createdStories } = createHarness({ isGuest: true });
  await app.ready();
  try {
    const response = await app.inject({ method: "POST", url: "/api/grace", payload: { channelId: 7, content: "来访者的恩典" } });
    assert.equal(response.statusCode, 200);
    assert.equal(createdMessages.length, 1);
    assert.deepEqual(createdStories, []);
  } finally {
    await app.close();
  }
});

test("POST /api/grace accepts voice-only cards and validates attachments in the same channel", async () => {
  const { app, sourceMessages, createdMessages, createdStories } = createHarness();
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
    assert.deepEqual(createdStories[0], { accountId: 2, graceMessageId: 1000, content: "", voiceMessageId: 501, imageMessageId: 502 });
    const wrongChannel = await app.inject({ method: "POST", url: "/api/grace", payload: { channelId: 7, content: "带图", imageMessageId: 503 } });
    assert.equal(wrongChannel.statusCode, 400);
  } finally {
    await app.close();
  }
});

test("POST /api/grace rolls back the card when story synchronization fails", async () => {
  const { app, deleted, createdMessages } = createHarness({ storyFails: true });
  await app.ready();
  try {
    const response = await app.inject({ method: "POST", url: "/api/grace", payload: { channelId: 7, content: "今天的恩典" } });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(deleted, []);
    assert.equal(createdMessages.length, 0);
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
    { id: 11, channelId: 7, senderActorId: 22, payload: { kind: "grace" }, createdAt: ownCreatedAt, channel: { id: 7, name: "团契" }, favorites: [] },
    { id: 12, channelId: 8, senderActorId: 44, payload: { kind: "grace" }, createdAt: ownCreatedAt, channel: { id: 8, name: "分享" }, favorites: [{ id: 91, createdAt: savedAt }] },
    { id: 13, channelId: 9, senderActorId: 22, payload: { kind: "grace" }, createdAt: ownCreatedAt, channel: { id: 9, name: "无权访问" }, favorites: [] },
    { id: 14, channelId: 7, senderActorId: 22, payload: { kind: "grace", sourceGraceMessageId: 11 }, createdAt: ownCreatedAt, channel: { id: 7, name: "团契" }, favorites: [] }
  );
  hydrated.set(11, message(11, 7));
  hydrated.set(12, message(12, 8, 44));
  hydrated.set(13, message(13, 9));
  hydrated.set(14, message(14, 7));
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

test("POST /api/messages/:id/grateful records gratitude on the canonical grace card", async () => {
  const { app, sourceMessages, hydrated, actions, emitted } = createHarness();
  sourceMessages.push({ id: 21, channelId: 7, type: "grace", payload: { kind: "grace" } });
  hydrated.set(21, { ...message(21, 7), payload: { kind: "grace", gratitudeCount: 1 } });
  await app.ready();
  try {
    const response = await app.inject({ method: "POST", url: "/api/messages/21/grateful", payload: {} });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(actions, [{ messageId: 21, accountId: 2 }]);
    assert.deepEqual(emitted, [{ room: "ch:7", event: "message:updated" }]);
  } finally {
    await app.close();
  }
});

test("POST /api/messages/:id/grace-update preserves history and creates a newest card", async () => {
  const { app, sourceMessages, hydrated, createdMessages, updates } = createHarness();
  sourceMessages.push({
    id: 31,
    channelId: 7,
    type: "grace",
    payload: { kind: "grace" },
    senderActorId: 22,
    content: "原来的见证",
    createdAt: new Date("2026-09-17T08:00:00.000Z"),
    sender: { accountId: 2 },
    filePath: null
  });
  hydrated.set(31, message(31, 7));
  await app.ready();
  try {
    const response = await app.inject({ method: "POST", url: "/api/messages/31/grace-update", payload: { content: "新的见证" } });
    assert.equal(response.statusCode, 200);
    assert.equal(updates[0]?.id, 31);
    const sourcePayload = updates[0]?.data.payload as { updates?: Array<{ content: string }>; latestUpdateBy?: string };
    assert.equal(sourcePayload.latestUpdateBy, "reader");
    assert.equal(sourcePayload.updates?.[0]?.content, "原来的见证");
    const created = createdMessages.at(-1);
    assert.equal(created?.type, "grace");
    assert.equal(created?.content, "新的见证");
    assert.equal((created?.payload as { sourceGraceMessageId?: number }).sourceGraceMessageId, 31);
  } finally {
    await app.close();
  }
});

test("deleting a grace card uses message deletion and leaves its created story untouched", async () => {
  const { app, sourceMessages, createdStories, deleted } = createHarness();
  await app.ready();
  const created = await app.inject({ method: "POST", url: "/api/grace", payload: { channelId: 7, content: "见证" } });
  assert.equal(created.statusCode, 200);
  sourceMessages.push({
    id: 1000,
    channelId: 7,
    type: "grace",
    payload: { kind: "grace" },
    senderActorId: 22,
    content: "见证",
    createdAt: new Date(),
    sender: { accountId: 2 },
    filePath: null
  });
  try {
    const response = await app.inject({ method: "DELETE", url: "/api/messages/1000/grace" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(deleted, [1000]);
    assert.equal(createdStories.length, 1);
  } finally {
    await app.close();
  }
});

function photoUpload(data: unknown, photos: Buffer[]) {
  const boundary = "grace-test-boundary";
  const chunks: Buffer[] = [Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="data"\r\n\r\n${JSON.stringify(data)}\r\n`)];
  for (const photo of photos) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="photo.heic"\r\nContent-Type: image/heic\r\n\r\n`), photo, Buffer.from("\r\n"));
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat(chunks) };
}

function editableSource(payload: Record<string, unknown> = {}) {
  return { id: 31, channelId: 7, type: "grace", payload: { kind: "grace", ...payload }, senderActorId: 22, content: "原来的见证", createdAt: new Date("2026-09-17T08:00:00.000Z"), sender: { accountId: 2 }, filePath: null };
}

test("multiple photos including a real HEIC are embedded in one card and copied to its story", async () => {
  const { app, createdMessages, createdStories, uploadDirectory, sourceMessages } = createHarness();
  const heic = fs.readFileSync("e2e/fixtures/story-sample.heic");
  const png = await sharp({ create: { width: 12, height: 8, channels: 3, background: "red" } }).png().toBuffer();
  try {
    const result = await app.inject({ method: "POST", url: "/api/grace", ...photoUpload({ channelId: 7, content: "多图恩典" }, [heic, png]) });
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(createdMessages.length, 1);
    assert.equal(createdMessages[0].type, "grace", "no standalone image messages");
    const payload = createdMessages[0].payload as { images: Array<{ fileName: string }> };
    assert.equal(payload.images.length, 2);
    assert.deepEqual(createdStories[0].imageFileNames, payload.images.map((image) => image.fileName));
    for (const image of payload.images) assert.equal((await sharp(path.join(uploadDirectory, image.fileName)).metadata()).format, "webp");
    sourceMessages.push({ ...editableSource(payload), id: 1000 });
    const image = await app.inject({ method: "GET", url: `/api/grace/1000/images/${payload.images[0].fileName}` });
    assert.equal(image.statusCode, 200);
    assert.equal(image.headers["content-type"], "image/webp");
    assert.equal(image.headers["cache-control"], "private, no-store");
    const missing = await app.inject({ method: "GET", url: "/api/grace/1000/images/00000000-0000-0000-0000-000000000000.webp" });
    assert.equal(missing.statusCode, 404);
  } finally { await app.close(); }
});

test("invalid images and failed story synchronization leave no uploaded files or card", async () => {
  for (const failStory of [false, true]) {
    const { app, uploadDirectory, createdMessages } = createHarness({ storyFails: failStory });
    const photo = failStory ? await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).png().toBuffer() : Buffer.from("invalid-heic");
    try {
      const result = await app.inject({ method: "POST", url: "/api/grace", ...photoUpload({ channelId: 7, content: "测试" }, [photo]) });
      assert.equal(result.statusCode, failStory ? 500 : 400);
      assert.deepEqual(fs.readdirSync(uploadDirectory), []);
      assert.equal(createdMessages.length, 0);
    } finally { await app.close(); }
  }
});

test("editing retains selected photos and history, while the story contains only new text and photos", async () => {
  const { app, sourceMessages, createdStories, updates } = createHarness();
  const oldImage = { fileName: "00000000-0000-0000-0000-000000000001.webp", width: 12, height: 8 };
  sourceMessages.push(editableSource({ images: [oldImage], updates: [{ content: "更早的见证", at: "2026-09-16", images: [oldImage] }] }));
  const png = await sharp({ create: { width: 12, height: 8, channels: 3, background: "red" } }).png().toBuffer();
  try {
    const response = await app.inject({ method: "POST", url: "/api/messages/31/grace-update", ...photoUpload({ content: "原来的见证\n后来康复了", retainedImages: [oldImage.fileName], expectedUpdateAt: null }, [png]) });
    assert.equal(response.statusCode, 200, response.body);
    const payload = updates[0].data.payload as { images: Array<{ fileName: string }>; updates: Array<{ images: unknown[] }> };
    assert.equal(payload.images.length, 2);
    assert.deepEqual(payload.updates[0].images, [oldImage]);
    assert.deepEqual(payload.updates[1].images, [oldImage]);
    assert.equal(createdStories.length, 1);
    assert.equal(createdStories[0].accountId, 2);
    assert.equal(createdStories[0].content, "恩典更新：\n后来康复了");
    assert.deepEqual(createdStories[0].imageFileNames, [payload.images[1].fileName]);
    assert.equal(createdStories[0].voiceMessageId, undefined);
  } finally { await app.close(); }
});

test("editing with no changes does not publish a card or story; stale and forged images are rejected", async () => {
  const { app, sourceMessages, createdMessages, createdStories } = createHarness();
  sourceMessages.push(editableSource());
  try {
    const unchanged = await app.inject({ method: "POST", url: "/api/messages/31/grace-update", payload: { content: "原来的见证" } });
    assert.equal(unchanged.statusCode, 200);
    assert.equal(unchanged.json().unchanged, true);
    assert.equal(createdMessages.length, 0);
    assert.equal(createdStories.length, 0);
    const stale = await app.inject({ method: "POST", url: "/api/messages/31/grace-update", payload: { content: "新内容", expectedUpdateAt: "2026-09-20" } });
    assert.equal(stale.statusCode, 409);
    const forged = await app.inject({ method: "POST", url: "/api/messages/31/grace-update", payload: { content: "新内容", retainedImages: ["00000000-0000-0000-0000-000000000000.webp"] } });
    assert.equal(forged.statusCode, 400);
  } finally { await app.close(); }
});

test("editing or reading images requires channel and author permissions", async () => {
  for (const kind of ["channel", "author", "write"] as const) {
    const { app, sourceMessages, createdStories, createdMessages } = createHarness({ canAccess: () => kind !== "channel", canWrite: kind !== "write" });
    const source = editableSource();
    if (kind === "author") source.sender.accountId = 88;
    sourceMessages.push(source);
    try {
      const response = await app.inject({ method: "POST", url: "/api/messages/31/grace-update", payload: { content: "新见证" } });
      assert.equal(response.statusCode, 403);
      assert.equal(createdMessages.length, 0);
      assert.equal(createdStories.length, 0);
      if (kind === "channel") assert.equal((await app.inject({ method: "GET", url: "/api/grace/31/images/00000000-0000-0000-0000-000000000000.webp" })).statusCode, 403);
    } finally { await app.close(); }
  }
});

test("a story sync failure leaves the original testimony unchanged", async () => {
  const { app, sourceMessages, updates, createdMessages } = createHarness({ storyFails: true });
  sourceMessages.push(editableSource());
  try {
    assert.equal((await app.inject({ method: "POST", url: "/api/messages/31/grace-update", payload: { content: "新的见证" } })).statusCode, 500);
    assert.equal(sourceMessages[0].content, "原来的见证");
    assert.equal(updates.length, 0);
    assert.equal(createdMessages.length, 0);
  } finally { await app.close(); }
});
