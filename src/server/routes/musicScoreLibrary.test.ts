import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { Prisma, type ChannelKind, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { registerMusicScoreLibraryRoutes } from "./musicScoreLibrary.js";
import type { AuthedMusicRequest, MusicAuthContext } from "./music.js";
import { createMusicScoreShareService, type MusicScoreLibraryRow } from "../services/musicScoreLibrary.js";

type StoredMessage = {
  id: number; senderActorId: number; channelId: number; clientRequestId: string; clientRequestHash: string;
  type: string; filePath: string; fileName: string; fileSize: number; content: string; payload: Prisma.InputJsonObject;
};
const auths: Record<string, MusicAuthContext> = {
  owner: { accountId: 10, actorId: 110, username: "owner", isAdmin: false, canPinMessages: false, sessionId: "owner" },
  other: { accountId: 20, actorId: 120, username: "other", isAdmin: false, canPinMessages: false, sessionId: "other" },
  manager: { accountId: 30, actorId: 130, username: "manager", isAdmin: false, canPinMessages: true, sessionId: "manager" },
  admin: { accountId: 40, actorId: 140, username: "admin", isAdmin: true, canPinMessages: false, sessionId: "admin" }
};
const headers = (token = "owner") => ({ authorization: `Bearer ${token}` });

async function harness(options: { missingPage?: number; failCreateAt?: number; failCommit?: boolean; failEmit?: boolean } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "music-score-library-"));
  const directories = { scores: path.join(root, "scores"), uploads: path.join(root, "uploads") };
  await fs.mkdir(directories.scores);
  await fs.mkdir(directories.uploads);
  const date = new Date("2026-01-01T00:00:00Z");
  function score(id: number, track: MusicScoreLibraryRow["track"], owner = 10, pdf = false): MusicScoreLibraryRow {
    return {
      id, trackId: track ? id + 100 : null, title: id === 1 ? "晨光合唱谱" : `歌谱 ${id}`, uploadedByAccountId: owner,
      createdAt: date, updatedAt: date, track,
      pages: Array.from({ length: pdf ? 1 : 2 }, (_, index) => ({
        id: id * 10 + index, scoreId: id, pageIndex: index,
        fileName: `${id}-${index}.${pdf ? "pdf" : "webp"}`, filePath: `${id}-${index}.${pdf ? "pdf" : "webp"}`,
        fileSize: 10, width: pdf ? 0 : 800, height: pdf ? 0 : 600, createdAt: date
      }))
    };
  }
  const audio = (channelId: number, kind: ChannelKind, fileName = "晨光.mp3") => ({ type: "file" as const, channelId, fileName, channel: { kind } });
  const scores = new Map<number, MusicScoreLibraryRow>([
    [1, score(1, audio(7, "music"))],
    [2, score(2, null)],
    [3, score(3, null, 20)],
    [4, score(4, audio(40, "standard", "私群歌曲.mp3"))],
    [5, score(5, audio(50, "direct", "私聊歌曲.mp3"))],
    [6, score(6, audio(60, "standard", "普通文档.txt"))],
    [7, score(7, null, 10, true)]
  ]);
  for (const row of scores.values()) for (const page of row.pages) {
    if (page.id !== options.missingPage) await fs.writeFile(path.join(directories.scores, page.filePath), `score-page-${page.id}`);
  }
  const messages = new Map<string, StoredMessage>();
  const emitted: number[] = [];
  const pushed: number[] = [];
  const accessChecks: number[] = [];
  let nextId = 1000;
  let createCount = 0;
  const transaction = { message: { create: async ({ data }: { data: Omit<StoredMessage, "id"> }) => {
    createCount += 1;
    if (createCount === options.failCreateAt) throw new Error("create failed");
    if (messages.has(`${data.senderActorId}:${data.clientRequestId}`)) throw new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" });
    const message = { ...data, id: nextId++ };
    messages.set(`${data.senderActorId}:${data.clientRequestId}`, message);
    return message;
  } } };
  const prisma = {
    musicScore: {
      findMany: async ({ where }: { where: { OR?: [{ title: { contains: string } }, unknown] } }) => {
        const search = where.OR?.[0].title.contains;
        return [...scores.values()].filter(row => !search || row.title.includes(search) || row.track?.fileName?.includes(search)).reverse();
      },
      findUnique: async ({ where }: { where: { id: number } }) => scores.get(where.id) || null
    },
    channel: { findUnique: async ({ where }: { where: { id: number } }) => ({ 10: { kind: "standard" }, 11: { kind: "direct" }, 12: { kind: "music" }, 13: { kind: "standard" } } as Record<number, { kind: string }>)[where.id] || null },
    message: {
      findUnique: async ({ where }: { where: { senderActorId_clientRequestId: { senderActorId: number; clientRequestId: string } } }) => {
        const key = where.senderActorId_clientRequestId;
        return messages.get(`${key.senderActorId}:${key.clientRequestId}`) || null;
      },
      findMany: async ({ where }: { where: { senderActorId: number; channelId: number; OR: [{ clientRequestId: string }, { clientRequestId: { startsWith: string } }] } }) => [...messages.values()]
        .filter(message => message.senderActorId === where.senderActorId && message.channelId === where.channelId && (message.clientRequestId === where.OR[0].clientRequestId || message.clientRequestId.startsWith(where.OR[1].clientRequestId.startsWith)))
        .sort((a, b) => a.id - b.id)
    },
    $transaction: async (action: (tx: typeof transaction) => Promise<unknown>) => {
      const before = new Map(messages);
      try {
        const result = await action(transaction);
        if (options.failCommit) throw new Error("commit failed");
        return result;
      } catch (error) {
        messages.clear();
        for (const [key, message] of before) messages.set(key, message);
        throw error;
      }
    }
  } as unknown as PrismaClient;
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => error instanceof z.ZodError
    ? reply.code(400).send({ success: false, message: "invalid request" })
    : reply.code(500).send({ success: false, message: "internal server error" }));
  registerMusicScoreLibraryRoutes(app, {
    prisma,
    requireAuth: async (request, reply) => {
      const auth = auths[String(request.headers.authorization || "").replace(/^Bearer /, "")];
      if (!auth) return reply.code(401).send({ success: false, message: "认证失败" });
      (request as AuthedMusicRequest).auth = auth;
    },
    canAccessChannel: async (accountId, channelId) => { accessChecks.push(channelId); return channelId === 40 && accountId === 10; },
    canWriteChannel: async (_accountId, channelId) => channelId === 10 || channelId === 11,
    isAudioFileName: (name) => /\.(mp3|m4a|ogg|webm|wav|aac)$/i.test(name || ""),
    musicScoreDir: directories.scores, uploadDir: directories.uploads,
    emitMessage: async (id) => { emitted.push(id); if (options.failEmit) throw new Error("emit failed"); },
    sendMessagePush: async (id) => { pushed.push(id); }
  });
  return { app, root, directories, scores, messages, emitted, pushed, accessChecks, prisma };
}

async function withHarness(context: { after(fn: () => Promise<unknown>): void }, options: Parameters<typeof harness>[0] = {}) {
  const h = await harness(options);
  context.after(async () => { await h.app.close(); await fs.rm(h.root, { recursive: true, force: true }); });
  return h;
}

test("score library authenticates every metadata and share route", async (context) => {
  const { app } = await withHarness(context);
  for (const request of [
    { method: "GET" as const, url: "/api/music/scores" },
    { method: "GET" as const, url: "/api/music/scores/1" },
    { method: "POST" as const, url: "/api/music/scores/1/share", payload: { channelId: 10, clientRequestId: crypto.randomUUID() } }
  ]) assert.equal((await app.inject(request)).statusCode, 401);
});

test("score library lists only readable bound and own unbound scores and searches title or track", async (context) => {
  const { app, accessChecks, directories, scores, messages } = await withHarness(context);
  const originalFiles = await fs.readdir(directories.scores);
  const originalIds = [...scores.keys()];
  const owner = await app.inject({ method: "GET", url: "/api/music/scores", headers: headers() });
  assert.equal(owner.statusCode, 200);
  assert.deepEqual(owner.json().scores.map((row: { id: number }) => row.id), [7, 4, 2, 1]);
  assert.deepEqual(owner.json().scores.at(-1), {
    id: 1, title: "晨光合唱谱", kind: "image", trackId: 101, trackTitle: "晨光",
    pages: [0, 1].map(index => ({ id: 10 + index, scoreId: 1, pageIndex: index, fileName: `1-${index}.webp`, fileSize: 10, width: 800, height: 600 }))
  });
  assert.ok(!JSON.stringify(owner.json()).includes("filePath"));
  assert.ok(!accessChecks.includes(7), "shared music scores do not require channel membership");
  const other = await app.inject({ method: "GET", url: "/api/music/scores", headers: headers("other") });
  assert.deepEqual(other.json().scores.map((row: { id: number }) => row.id), [3, 1]);
  const byTitle = await app.inject({ method: "GET", url: `/api/music/scores?search=${encodeURIComponent("合唱谱")}`, headers: headers() });
  assert.deepEqual(byTitle.json().scores.map((row: { id: number }) => row.id), [1]);
  const byTrack = await app.inject({ method: "GET", url: `/api/music/scores?search=${encodeURIComponent("私群歌曲")}`, headers: headers() });
  assert.deepEqual(byTrack.json().scores.map((row: { id: number }) => row.id), [4]);
  const detail = await app.inject({ method: "GET", url: "/api/music/scores/1", headers: headers() });
  assert.equal(detail.statusCode, 200);
  assert.deepEqual(detail.json().score.pages, owner.json().scores.at(-1).pages);
  assert.deepEqual([...scores.keys()], originalIds, "browsing reuses the existing score records");
  assert.deepEqual(await fs.readdir(directories.scores), originalFiles, "browsing never duplicates source pages");
  assert.deepEqual(await fs.readdir(directories.uploads), [], "only an explicit share may create chat attachments");
  assert.equal(messages.size, 0);
});

test("score detail and sharing keep page source permission, invalid-track and missing rules", async (context) => {
  const { app, messages } = await withHarness(context);
  for (const [id, token, status] of [[2, "other", 403], [2, "manager", 200], [3, "admin", 200], [4, "other", 403], [5, "owner", 403], [6, "owner", 404], [999, "owner", 404]] as const) {
    assert.equal((await app.inject({ method: "GET", url: `/api/music/scores/${id}`, headers: headers(token) })).statusCode, status);
    if (status !== 200) assert.equal((await app.inject({ method: "POST", url: `/api/music/scores/${id}/share`, headers: headers(token), payload: { channelId: 10, clientRequestId: crypto.randomUUID() } })).statusCode, status);
  }
  assert.equal(messages.size, 0);
});

test("score sharing validates targets, writable permission and request IDs before copying", async (context) => {
  const { app, messages, directories } = await withHarness(context);
  for (const [channelId, expected] of [[12, 400], [13, 403], [999, 400]]) {
    const result = await app.inject({ method: "POST", url: "/api/music/scores/1/share", headers: headers(), payload: { channelId, clientRequestId: crypto.randomUUID() } });
    assert.equal(result.statusCode, expected);
  }
  assert.equal((await app.inject({ method: "POST", url: "/api/music/scores/1/share", headers: headers(), payload: { channelId: 10, clientRequestId: "invalid" } })).statusCode, 400);
  assert.equal(messages.size, 0);
  assert.deepEqual(await fs.readdir(directories.uploads), []);
});

test("sharing image pages creates ordered independent attachments and retries return the same group", async (context) => {
  const h = await withHarness(context);
  const clientRequestId = crypto.randomUUID();
  const request = { method: "POST" as const, url: "/api/music/scores/1/share", headers: headers(), payload: { channelId: 10, clientRequestId } };
  const first = await h.app.inject(request);
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.json(), { success: true, forwarded: 2, messageIds: [1000, 1001], deduplicated: false });
  const rows = [...h.messages.values()];
  for (const [index, message] of rows.entries()) {
    assert.equal(message.type, "image");
    assert.equal(message.payload.imageWidth, 800);
    assert.equal(message.payload.musicScorePageIndex, index);
    assert.notEqual(message.filePath, h.scores.get(1)!.pages[index].filePath);
    assert.equal(await fs.readFile(path.join(h.directories.uploads, message.filePath), "utf8"), `score-page-${10 + index}`);
  }
  assert.deepEqual(h.emitted, [1000, 1001]);
  assert.deepEqual(h.pushed, [1000, 1001]);
  await fs.rm(h.directories.scores, { recursive: true });
  for (const row of rows) await fs.access(path.join(h.directories.uploads, row.filePath));
  const repeated = await h.app.inject(request);
  assert.deepEqual(repeated.json(), { ...first.json(), deduplicated: true });
  assert.equal(h.messages.size, 2);
  assert.equal((await fs.readdir(h.directories.uploads)).length, 2);
  assert.deepEqual(h.emitted, [1000, 1001]);
  const conflict = await h.app.inject({ ...request, payload: { channelId: 11, clientRequestId } });
  assert.equal(conflict.statusCode, 409);
});

test("PDF scores share as a native file into a direct chat and an emit failure keeps committed files", async (context) => {
  const h = await withHarness(context, { failEmit: true });
  const response = await h.app.inject({ method: "POST", url: "/api/music/scores/7/share", headers: headers(), payload: { channelId: 11, clientRequestId: crypto.randomUUID() } });
  assert.equal(response.statusCode, 200);
  const message = [...h.messages.values()][0];
  assert.equal(message.type, "file");
  assert.equal(message.fileName, "7-0.pdf");
  assert.equal(message.payload.imageWidth, undefined);
  assert.equal(await fs.readFile(path.join(h.directories.uploads, message.filePath), "utf8"), "score-page-70");
  assert.deepEqual(h.pushed, [message.id]);
});

test("concurrent retries share one complete group and actor request IDs stay isolated", async (context) => {
  const h = await withHarness(context);
  const payload = { channelId: 10, clientRequestId: crypto.randomUUID() };
  const requests = await Promise.all([0, 1].map(() => h.app.inject({ method: "POST", url: "/api/music/scores/1/share", headers: headers(), payload })));
  assert.ok(requests.every(response => response.statusCode === 200));
  assert.deepEqual(requests.map(response => response.json().deduplicated).sort(), [false, true]);
  assert.equal(h.messages.size, 2);
  const other = await h.app.inject({ method: "POST", url: "/api/music/scores/1/share", headers: headers("other"), payload });
  assert.equal(other.statusCode, 200);
  assert.equal(h.messages.size, 4);
});

test("a restarted share service replays durable IDs without recopying files", async (context) => {
  const h = await withHarness(context);
  const input = { score: h.scores.get(1)!, actorId: 110, channelId: 10, clientRequestId: crypto.randomUUID() };
  const first = await createMusicScoreShareService(h.prisma, h.directories).share(input);
  const repeated = await createMusicScoreShareService(h.prisma, h.directories).share(input);
  assert.deepEqual(repeated, { state: "replayed", messageIds: first.messageIds });
  assert.equal(h.messages.size, 2);
  assert.equal((await fs.readdir(h.directories.uploads)).length, 2);
});

test("copy, intermediate create and commit failures leave no partial messages or upload files", async (context) => {
  for (const options of [{ missingPage: 11 }, { failCreateAt: 2 }, { failCommit: true }]) {
    const h = await withHarness(context, options);
    const response = await h.app.inject({ method: "POST", url: "/api/music/scores/1/share", headers: headers(), payload: { channelId: 10, clientRequestId: crypto.randomUUID() } });
    assert.equal(response.statusCode, "missingPage" in options ? 404 : 500);
    assert.equal(h.messages.size, 0);
    assert.deepEqual(await fs.readdir(h.directories.uploads), []);
    assert.deepEqual(h.emitted, []);
    assert.deepEqual(h.pushed, []);
  }
});
