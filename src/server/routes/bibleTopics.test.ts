import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import Fastify, { type FastifyRequest } from "fastify";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { MessageDTO } from "../../shared/types.js";
import { BIBLE_TOPIC_NAME_MAX } from "../../shared/bibleTopics.js";
import { registerBibleTopicRoutes } from "./bibleTopics.js";

type TopicRow = {
  id: number;
  accountId: number;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  entries: EntryRow[];
};
type EntryRow = {
  id: number;
  topicId: number;
  sortOrder: number;
  bookCode: string;
  startChapter: number;
  startVerse: number;
  endChapter: number;
  endVerse: number;
};

function entryKey(entry: Omit<EntryRow, "id" | "sortOrder" | "topicId">) {
  return `${entry.bookCode}|${entry.startChapter}|${entry.startVerse}|${entry.endChapter}|${entry.endVerse}`;
}

async function harness() {
  const topics: TopicRow[] = [];
  const messages: Array<{ id: number; channelId: number; type: string; content: string; payload: unknown; senderActorId: number; clientRequestId: string }> = [];
  let writable = true;
  let channelKind = "standard";
  let nextId = 1;
  const prisma = {
    bibleTopic: {
      findMany: async ({ where }: { where: { accountId: number } }) => topics.filter((topic) => topic.accountId === where.accountId).sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime()),
      count: async ({ where }: { where: { accountId: number } }) => topics.filter((topic) => topic.accountId === where.accountId).length,
      findUnique: async ({ where }: { where: { id: number } }) => topics.find((topic) => topic.id === where.id) || null,
      create: async ({ data }: { data: { accountId: number; name: string } }) => {
        if (topics.some((topic) => topic.accountId === data.accountId && topic.name === data.name)) {
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
        }
        const topic: TopicRow = { id: nextId++, accountId: data.accountId, name: data.name, createdAt: new Date(), updatedAt: new Date(), entries: [] };
        topics.push(topic);
        return topic;
      },
      update: async ({ where, data }: { where: { id: number }; data: { name?: string; updatedAt?: Date } }) => {
        const topic = topics.find((row) => row.id === where.id)!;
        if (data.name !== undefined) {
          if (topics.some((row) => row.accountId === topic.accountId && row.name === data.name && row.id !== topic.id)) {
            throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
          }
          topic.name = data.name;
        }
        topic.updatedAt = new Date();
        return topic;
      },
      deleteMany: async ({ where }: { where: { id: number; accountId: number } }) => {
        const index = topics.findIndex((topic) => topic.id === where.id && topic.accountId === where.accountId);
        if (index >= 0) topics.splice(index, 1);
        return { count: index >= 0 ? 1 : 0 };
      }
    },
    bibleTopicEntry: {
      createMany: async ({ data, skipDuplicates }: { data: Array<Omit<EntryRow, "id">>; skipDuplicates?: boolean }) => {
        const topic = topics.find((row) => row.id === data[0].topicId)!;
        let count = 0;
        for (const entry of data) {
          if (skipDuplicates && topic.entries.some((existing) => entryKey(existing) === entryKey(entry))) continue;
          topic.entries.push({ ...entry, id: nextId++ });
          count++;
        }
        return { count };
      },
      deleteMany: async ({ where }: { where: { topicId: number; id: { in: number[] } } }) => {
        const topic = topics.find((row) => row.id === where.topicId)!;
        const before = topic.entries.length;
        topic.entries = topic.entries.filter((entry) => !where.id.in.includes(entry.id));
        return { count: before - topic.entries.length };
      }
    },
    channel: { findUnique: async () => ({ id: 1, kind: channelKind }) },
    message: {
      findUnique: async ({ where }: { where: { senderActorId_clientRequestId: { senderActorId: number; clientRequestId: string } } }) =>
        messages.find((message) => message.senderActorId === where.senderActorId_clientRequestId.senderActorId && message.clientRequestId === where.senderActorId_clientRequestId.clientRequestId) || null,
      create: async ({ data }: { data: Omit<(typeof messages)[number], "id"> }) => {
        const message = { ...data, id: nextId++ };
        messages.push(message);
        return message;
      }
    },
    $queryRaw: async () => [],
    $transaction: async (run: (tx: Prisma.TransactionClient) => Promise<unknown>) => run(prisma as unknown as Prisma.TransactionClient)
  };
  const app = Fastify();
  let pushes = 0;
  let emitted = 0;
  registerBibleTopicRoutes(app, {
    prisma: prisma as unknown as PrismaClient,
    requireAuth: async (request: FastifyRequest, reply) => {
      if (request.headers["x-account"] === "none") { reply.code(401).send({ message: "请登录" }); return; }
      const id = Number(request.headers["x-account"] || 1);
      Object.assign(request, { auth: { accountId: id, actorId: id } });
    },
    canWriteChannel: async () => writable,
    emitMessage: async () => { emitted++; },
    sendMessagePush: async () => { pushes++; },
    hydrateMessage: async (id) => ({ ...messages.find((message) => message.id === id)! }) as unknown as MessageDTO
  });
  return {
    app, topics, messages,
    pushes: () => pushes,
    emitted: () => emitted,
    setWritable: (value: boolean) => { writable = value; },
    setChannelKind: (kind: string) => { channelKind = kind; }
  };
}

const povertyReference = "申命记8:17–18；历代志上29:14–16；约伯记1:21；诗篇40:17；49:6–9；86:1；以赛亚书55:1–3；57:15；66:2；马太福音5:3；18:23–27；路加福音18:9–14；罗马书3:23–24；哥林多前书1:26–31；4:7；哥林多后书3:5；8:9；以弗所书2:1–9；启示录3:17–18";

test("bible topics keep per-account CRUD with unique names", async () => {
  const h = await harness();
  try {
    assert.equal((await h.app.inject({ method: "POST", url: "/api/bible/topics", payload: { name: " " } })).statusCode, 400);
    assert.equal((await h.app.inject({ method: "POST", url: "/api/bible/topics", payload: { name: "x".repeat(BIBLE_TOPIC_NAME_MAX + 1) } })).statusCode, 400);
    const created = await h.app.inject({ method: "POST", url: "/api/bible/topics", payload: { name: "我们在神面前都是穷人" } });
    assert.equal(created.statusCode, 200);
    const topic = created.json().topic;
    assert.equal(topic.name, "我们在神面前都是穷人");
    assert.deepEqual(topic.passages, []);
    assert.equal((await h.app.inject({ method: "POST", url: "/api/bible/topics", payload: { name: "我们在神面前都是穷人" } })).statusCode, 409);
    // 其他账号看不到、改不到
    assert.equal((await h.app.inject({ method: "PATCH", url: `/api/bible/topics/${topic.id}`, headers: { "x-account": "2" }, payload: { name: "抢占" } })).statusCode, 404);
    assert.equal((await h.app.inject({ method: "DELETE", url: `/api/bible/topics/${topic.id}`, headers: { "x-account": "2" } })).json().success, true);
    assert.equal(h.topics.length, 1);
    const renamed = await h.app.inject({ method: "PATCH", url: `/api/bible/topics/${topic.id}`, payload: { name: "神眼中的穷人" } });
    assert.equal(renamed.json().topic.name, "神眼中的穷人");
    const listed = await h.app.inject({ method: "GET", url: "/api/bible/topics", headers: { "x-account": "2" } });
    assert.deepEqual(listed.json().topics, []);
    assert.equal((await h.app.inject({ method: "DELETE", url: `/api/bible/topics/${topic.id}` })).json().success, true);
    assert.equal(h.topics.length, 0);
  } finally {
    await h.app.close();
  }
});

test("batch passage addition parses a pasted reference list and skips duplicates", async () => {
  const h = await harness();
  try {
    const topic = (await h.app.inject({ method: "POST", url: "/api/bible/topics", payload: { name: "我们在神面前都是穷人" } })).json().topic;
    assert.equal((await h.app.inject({ method: "POST", url: `/api/bible/topics/${topic.id}/passages`, payload: { reference: "不是经文" } })).statusCode, 400);
    const added = await h.app.inject({ method: "POST", url: `/api/bible/topics/${topic.id}/passages`, payload: { reference: povertyReference } });
    assert.equal(added.statusCode, 200);
    const body = added.json();
    assert.equal(body.added, 19);
    assert.equal(body.duplicates, 0);
    assert.equal(body.topic.passages.length, 19);
    assert.equal(body.topic.passages[0].reference, "申命记 8:17-18");
    assert.equal(body.topic.passages[4].reference, "诗篇 49:6-9");
    assert.equal(body.topic.passages[18].bookCode, "REV");
    // 重复添加同一段：全部跳过，清单不变
    const again = await h.app.inject({ method: "POST", url: `/api/bible/topics/${topic.id}/passages`, payload: { reference: "诗篇49:6–9" } });
    assert.equal(again.json().added, 0);
    assert.equal(again.json().duplicates, 1);
    assert.equal(again.json().topic.passages.length, 19);
    // 移除一段后列表同步
    const removed = await h.app.inject({ method: "DELETE", url: `/api/bible/topics/${topic.id}/passages`, payload: { passageIds: [body.topic.passages[0].id] } });
    assert.equal(removed.json().topic.passages.length, 18);
  } finally {
    await h.app.close();
  }
});

test("topic share creates a self-contained card message with channel checks and replay safety", async () => {
  const h = await harness();
  try {
    const topic = (await h.app.inject({ method: "POST", url: "/api/bible/topics", payload: { name: "我们在神面前都是穷人" } })).json().topic;
    const clientRequestId = crypto.randomUUID();
    // 空主题不能转发
    assert.equal((await h.app.inject({ method: "POST", url: `/api/bible/topics/${topic.id}/share`, payload: { channelId: 1, clientRequestId } })).statusCode, 400);
    await h.app.inject({ method: "POST", url: `/api/bible/topics/${topic.id}/passages`, payload: { reference: povertyReference } });
    // 无发言权 / 非聊天频道
    h.setWritable(false);
    assert.equal((await h.app.inject({ method: "POST", url: `/api/bible/topics/${topic.id}/share`, payload: { channelId: 1, clientRequestId } })).statusCode, 403);
    h.setWritable(true);
    h.setChannelKind("music");
    assert.equal((await h.app.inject({ method: "POST", url: `/api/bible/topics/${topic.id}/share`, payload: { channelId: 1, clientRequestId } })).statusCode, 403);
    h.setChannelKind("standard");
    const shared = await h.app.inject({ method: "POST", url: `/api/bible/topics/${topic.id}/share`, payload: { channelId: 1, clientRequestId } });
    assert.equal(shared.statusCode, 200);
    const message = h.messages[0];
    assert.equal(message.type, "text");
    assert.equal(message.channelId, 1);
    assert.ok(message.content.startsWith("经文主题 · 我们在神面前都是穷人"));
    assert.ok(message.content.includes("诗篇 49:6-9"));
    const payload = message.payload as { kind: string; name: string; translation: string; passages: Array<{ reference: string; text: string }> };
    assert.equal(payload.kind, "bible_topic");
    assert.equal(payload.name, "我们在神面前都是穷人");
    assert.equal(payload.translation, "新标点和合本（简体）");
    assert.equal(payload.passages.length, 19);
    assert.ok(payload.passages.every((passage) => passage.text.length > 0));
    assert.equal(h.emitted(), 1);
    assert.equal(h.pushes(), 1);
    // 同一 clientRequestId 重放不产生第二条消息
    const replay = await h.app.inject({ method: "POST", url: `/api/bible/topics/${topic.id}/share`, payload: { channelId: 1, clientRequestId } });
    assert.equal(replay.statusCode, 200);
    assert.equal(h.messages.length, 1);
    assert.equal(h.pushes(), 1);
  } finally {
    await h.app.close();
  }
});
