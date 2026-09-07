/// <reference types="node" />

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import Fastify, { type FastifyRequest } from "fastify";
import { chatRecordStoredFile, registerForwardRoutes, type ForwardSourceMessage } from "./forward.js";

type HarnessOptions = {
  messages?: Array<Partial<ForwardSourceMessage> & { id: number; channelId: number }>;
  canAccess?: boolean;
  canWrite?: boolean;
  targetKinds?: Array<"standard" | "direct" | "music">;
  sourceChannel?: { kind: "standard" | "direct"; name: string; directKey: string | null; members: Array<{ account: { displayName: string } }> };
};

function textMessage(id: number, content: string): Partial<ForwardSourceMessage> & { id: number; channelId: number } {
  return {
    id,
    channelId: 5,
    type: "text",
    content,
    payload: null,
    fileName: null,
    filePath: null,
    fileSize: null,
    createdAt: new Date("2026-09-07T07:00:00.000Z"),
    sender: { displayName: `用户${id}`, avatarPath: null }
  } as Partial<ForwardSourceMessage> & { id: number; channelId: number };
}

function createForwardHarness(options: HarnessOptions = {}) {
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "tm3-forward-test-"));
  const sourceFile = path.join(uploadDir, "source-audio.m4a");
  fs.writeFileSync(sourceFile, "fake-audio");
  const state = {
    created: [] as Array<Record<string, unknown>>,
    emitted: [] as number[],
    pushed: [] as number[],
    uploadDir
  };
  let nextId = 900;
  const messages = (options.messages ?? [textMessage(1, "你好"), textMessage(2, "再见")]) as ForwardSourceMessage[];
  const prisma = {
    message: {
      findMany: async ({ where }: { where: { id: { in: number[] } } }) =>
        messages.filter((message) => where.id.in.includes(message.id)),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.created.push(data);
        return { id: nextId++, ...data };
      }
    },
    channel: {
      findMany: async ({ where }: { where: { id: { in: number[] }; kind?: { in: string[] } } }) =>
        where.id.in
          .map((id, index) => ({ id, kind: options.targetKinds?.[index] ?? "standard" }))
          .filter((channel) => !where.kind || where.kind.in.includes(channel.kind)),
      findUnique: async () =>
        options.sourceChannel ?? {
          kind: "standard",
          name: "团契小组",
          directKey: null,
          members: [{ account: { displayName: "张三" } }, { account: { displayName: "李四" } }]
        }
    },
    $transaction: async (promises: Array<Promise<unknown>>) => Promise.all(promises)
  };
  const app = Fastify();
  const requireAuth = async (request: FastifyRequest) => {
    (request as FastifyRequest & { auth: { accountId: number; actorId: number } }).auth = { accountId: 1, actorId: 7 };
  };
  registerForwardRoutes(app, {
    prisma: prisma as unknown as PrismaClient,
    requireAuth,
    canAccessChannel: async () => options.canAccess !== false,
    canWriteChannel: async () => options.canWrite !== false,
    emitMessage: async (id: number) => {
      state.emitted.push(id);
    },
    sendMessagePush: async (id: number) => {
      state.pushed.push(id);
    },
    uploadDir
  });
  return { app, state, uploadDir };
}

test("separate forward copies text messages to each target channel", async () => {
  const { app, state } = createForwardHarness();
  const response = await app.inject({
    method: "POST",
    url: "/api/messages/forward",
    payload: { messageIds: [1, 2], channelIds: [10, 11], mode: "separate" }
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { success: true, forwarded: 4, skipped: 0 });
  assert.equal(state.created.length, 4);
  assert.deepEqual(
    state.created.map((data) => [data.channelId, data.content, data.type, data.senderActorId]),
    [
      [10, "你好", "text", 7],
      [10, "再见", "text", 7],
      [11, "你好", "text", 7],
      [11, "再见", "text", 7]
    ]
  );
  assert.equal(state.emitted.length, 4);
  assert.equal(state.pushed.length, 4);
});

test("separate forward physically copies attachment files", async () => {
  const fileMessage = {
    ...textMessage(3, ""),
    type: "file",
    fileName: "voice.m4a",
    filePath: "source-audio.m4a",
    fileSize: 10,
    payload: { kind: "voice", durationMs: 1200, mimeType: "audio/mp4" }
  } as Partial<ForwardSourceMessage> & { id: number; channelId: number };
  const { app, state, uploadDir } = createForwardHarness({ messages: [fileMessage] });
  const response = await app.inject({
    method: "POST",
    url: "/api/messages/forward",
    payload: { messageIds: [3], channelIds: [10], mode: "separate" }
  });
  assert.equal(response.statusCode, 200);
  const created = state.created[0] as { filePath: string; fileName: string; payload: { kind: string } };
  assert.notEqual(created.filePath, "source-audio.m4a");
  assert.equal(fs.readFileSync(path.join(uploadDir, created.filePath), "utf8"), "fake-audio");
  assert.equal(created.payload.kind, "voice");
});

test("merged forward creates one chat_record snapshot per target channel", async () => {
  const { app, state } = createForwardHarness();
  const response = await app.inject({
    method: "POST",
    url: "/api/messages/forward",
    payload: { messageIds: [2, 1], channelIds: [10, 11], mode: "merged" }
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { success: true, forwarded: 2, skipped: 0 });
  assert.equal(state.created.length, 2);
  const record = state.created[0] as { type: string; content: string; payload: { kind: string; title: string; itemCount: number; items: Array<{ senderName: string; content?: string }> } };
  assert.equal(record.type, "chat_record");
  assert.equal(record.payload.kind, "chat_record");
  assert.equal(record.payload.title, "团契小组的聊天记录");
  assert.match(record.content, /\[聊天记录\]/);
  assert.equal(record.payload.itemCount, 2);
  // 条目按消息 id 升序排列，与客户端传入选中顺序无关
  assert.deepEqual(record.payload.items.map((item) => item.content), ["你好", "再见"]);
  assert.equal(record.payload.items[0]?.senderName, "用户1");
});

test("merged forward uses both member names for direct channels", async () => {
  const { app, state } = createForwardHarness({
    sourceChannel: {
      kind: "direct",
      name: "私聊",
      directKey: "1:2",
      members: [{ account: { displayName: "张三" } }, { account: { displayName: "李四" } }]
    }
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/messages/forward",
    payload: { messageIds: [1], channelIds: [10], mode: "merged" }
  });
  assert.equal(response.statusCode, 200);
  const record = state.created[0] as { payload: { title: string } };
  assert.equal(record.payload.title, "张三和李四的聊天记录");
});

test("unsupported message types are skipped and reported", async () => {
  const systemMessage = { ...textMessage(4, "系统消息"), type: "system" } as Partial<ForwardSourceMessage> & { id: number; channelId: number };
  const { app, state } = createForwardHarness({ messages: [textMessage(1, "你好"), systemMessage] });
  const response = await app.inject({
    method: "POST",
    url: "/api/messages/forward",
    payload: { messageIds: [1, 4], channelIds: [10], mode: "merged" }
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { success: true, forwarded: 1, skipped: 1 });
  const record = state.created[0] as { payload: { itemCount: number } };
  assert.equal(record.payload.itemCount, 1);
});

test("forward rejects when every message is unsupported", async () => {
  const prayer = { ...textMessage(5, "代祷"), type: "prayer" } as Partial<ForwardSourceMessage> & { id: number; channelId: number };
  const { app } = createForwardHarness({ messages: [prayer] });
  const response = await app.inject({
    method: "POST",
    url: "/api/messages/forward",
    payload: { messageIds: [5], channelIds: [10], mode: "separate" }
  });
  assert.equal(response.statusCode, 400);
});

test("forward rejects messages spanning multiple channels", async () => {
  const other = { ...textMessage(6, "别的频道"), channelId: 6 } as Partial<ForwardSourceMessage> & { id: number; channelId: number };
  const { app } = createForwardHarness({ messages: [textMessage(1, "你好"), other] });
  const response = await app.inject({
    method: "POST",
    url: "/api/messages/forward",
    payload: { messageIds: [1, 6], channelIds: [10], mode: "separate" }
  });
  assert.equal(response.statusCode, 400);
});

test("forward enforces source access and target write permissions", async () => {
  const denied = await createForwardHarness({ canAccess: false }).app.inject({
    method: "POST",
    url: "/api/messages/forward",
    payload: { messageIds: [1], channelIds: [10], mode: "separate" }
  });
  assert.equal(denied.statusCode, 403);

  const readOnly = await createForwardHarness({ canWrite: false }).app.inject({
    method: "POST",
    url: "/api/messages/forward",
    payload: { messageIds: [1], channelIds: [10], mode: "separate" }
  });
  assert.equal(readOnly.statusCode, 403);
});

test("forward rejects unknown or unsupported target channels", async () => {
  const { app } = createForwardHarness({ targetKinds: ["music"] });
  const response = await app.inject({
    method: "POST",
    url: "/api/messages/forward",
    payload: { messageIds: [1], channelIds: [10, 11], mode: "separate" }
  });
  assert.equal(response.statusCode, 400);
});

test("forward validates the request body", async () => {
  const { app } = createForwardHarness();
  for (const payload of [
    {},
    { messageIds: [], channelIds: [10], mode: "separate" },
    { messageIds: [1], channelIds: [], mode: "separate" },
    { messageIds: [1], channelIds: [10], mode: "combined" },
    { messageIds: Array.from({ length: 101 }, (_, index) => index + 1), channelIds: [10], mode: "merged" }
  ]) {
    const response = await app.inject({ method: "POST", url: "/api/messages/forward", payload });
    assert.equal(response.statusCode, 400, JSON.stringify(payload));
  }
});

test("forward returns 404 when a message id does not exist", async () => {
  const { app } = createForwardHarness();
  const response = await app.inject({
    method: "POST",
    url: "/api/messages/forward",
    payload: { messageIds: [1, 999], channelIds: [10], mode: "separate" }
  });
  assert.equal(response.statusCode, 404);
});

test("chatRecordStoredFile resolves items only from chat_record payloads", () => {
  const payload = {
    kind: "chat_record",
    title: "t",
    sourceChannelId: 5,
    itemCount: 2,
    items: [
      { senderName: "a", type: "text", content: "hi", createdAt: "2026-09-07T00:00:00.000Z" },
      { senderName: "b", type: "image", fileName: "photo.jpg", storedFile: "uuid-photo.jpg", createdAt: "2026-09-07T00:01:00.000Z" }
    ]
  };
  assert.equal(chatRecordStoredFile(payload, 0), null);
  assert.deepEqual(chatRecordStoredFile(payload, 1), { fileName: "photo.jpg", storedFile: "uuid-photo.jpg" });
  assert.equal(chatRecordStoredFile(payload, 2), null);
  assert.equal(chatRecordStoredFile({ kind: "chat_record" }, 1), null);
  assert.equal(chatRecordStoredFile(null, 0), null);
  assert.equal(chatRecordStoredFile({ kind: "other" }, 0), null);
});
