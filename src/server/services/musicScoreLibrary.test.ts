import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Prisma, type PrismaClient } from "@prisma/client";
import { createMusicScoreShareService, MusicScoreShareError, type MusicScoreLibraryRow } from "./musicScoreLibrary.js";
import { messageSendRequestHash } from "./messageSendIdempotency.js";

type StoredMessage = Prisma.MessageUncheckedCreateInput & { id: number; clientRequestHash: string | null };

async function harness(context: { after(fn: () => Promise<unknown>): void }, pdf = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "music-score-share-reply-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const directories = { scores: path.join(root, "scores"), uploads: path.join(root, "uploads") };
  await fs.mkdir(directories.scores);
  const createdAt = new Date("2026-01-01T00:00:00Z");
  const score: MusicScoreLibraryRow = {
    id: 7, title: "平安 <合唱> & 伴奏", trackId: 70, uploadedByAccountId: 10,
    createdAt, updatedAt: createdAt,
    track: { type: "file", channelId: 3, fileName: "平安之歌.mp3", channel: { kind: "music" } },
    pages: Array.from({ length: pdf ? 1 : 2 }, (_, index) => ({
      id: 71 + index, scoreId: 7, pageIndex: index,
      fileName: `歌谱-${index + 1}.${pdf ? "pdf" : "webp"}`,
      filePath: `stored-${index}.${pdf ? "pdf" : "webp"}`,
      fileSize: 10, width: pdf ? 0 : 800, height: pdf ? 0 : 1200, createdAt
    }))
  };
  for (const page of score.pages) await fs.writeFile(path.join(directories.scores, page.filePath), `score-page-${page.id}`);
  const messages = new Map<string, StoredMessage>();
  let nextId = 1000;
  const transaction = { message: { create: async ({ data }: { data: Prisma.MessageUncheckedCreateInput }) => {
    const key = `${data.senderActorId}:${data.clientRequestId}`;
    if (messages.has(key)) throw new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" });
    const message: StoredMessage = { ...data, id: nextId++, clientRequestHash: data.clientRequestHash ?? null };
    messages.set(key, message);
    return message;
  } } };
  const prisma = {
    message: {
      findUnique: async ({ where }: { where: { senderActorId_clientRequestId: { senderActorId: number; clientRequestId: string } } }) => {
        const { senderActorId, clientRequestId } = where.senderActorId_clientRequestId;
        return messages.get(`${senderActorId}:${clientRequestId}`) ?? null;
      },
      findMany: async ({ where }: { where: { senderActorId: number; channelId: number; OR: [{ clientRequestId: string }, { clientRequestId: { startsWith: string } }] } }) => [...messages.values()]
        .filter(message => message.senderActorId === where.senderActorId && message.channelId === where.channelId && (
          message.clientRequestId === where.OR[0].clientRequestId || message.clientRequestId?.startsWith(where.OR[1].clientRequestId.startsWith)
        ))
        .sort((left, right) => left.id - right.id)
        .map(message => ({ id: message.id }))
    },
    $transaction: async (action: (tx: typeof transaction) => Promise<unknown>) => {
      const before = new Map(messages);
      try {
        return await action(transaction);
      } catch (error) {
        messages.clear();
        for (const [key, message] of before) messages.set(key, message);
        throw error;
      }
    }
  } as unknown as PrismaClient;
  const service = createMusicScoreShareService(prisma, directories);
  return { service, prisma, directories, messages, input: { score, actorId: 110, channelId: 11, clientRequestId: crypto.randomUUID() } };
}

test("ordinary score shares preserve their existing hash and attachment payload", async context => {
  const h = await harness(context);
  assert.deepEqual(await h.service.share(h.input), { state: "created", messageIds: [1000, 1001] });
  const expectedHash = messageSendRequestHash({
    channelId: 11, content: "", type: "music_score_share", payload: { scoreId: 7 }, replyToId: null
  });
  for (const [index, message] of [...h.messages.values()].entries()) {
    assert.equal(message.clientRequestHash, expectedHash);
    assert.equal(Object.hasOwn(message, "replyToId"), false);
    assert.equal(message.content, "平安 &lt;合唱&gt; &amp; 伴奏");
    assert.deepEqual(message.payload, {
      sourceMusicScoreId: 7, musicScoreShareRequestId: h.input.clientRequestId, musicScorePageIndex: index,
      imageWidth: 800, imageHeight: 1200
    });
  }
});

test("AI score replies attach only controlled metadata and the reply target to every page", async context => {
  const h = await harness(context);
  const reply = {
    messageId: 90, aiRole: "ai_slmm", activationMode: "direct", anchorMessageId: 89,
    sourceMusicScoreId: 999, unsafeMetadata: "must not be copied"
  };
  assert.deepEqual(await h.service.share({ ...h.input, reply }), { state: "created", messageIds: [1000, 1001] });
  const expectedMetadata = {
    aiRole: "ai_slmm", triggerMessageId: 90, aiActivationMode: "direct", activationAnchorMessageId: 89
  };
  const expectedHash = messageSendRequestHash({
    channelId: 11, content: "", type: "music_score_share", payload: { scoreId: 7, ...expectedMetadata }, replyToId: 90
  });
  for (const [index, message] of [...h.messages.values()].entries()) {
    assert.equal(message.replyToId, 90);
    assert.equal(message.clientRequestHash, expectedHash);
    assert.deepEqual(message.payload, {
      sourceMusicScoreId: 7, musicScoreShareRequestId: h.input.clientRequestId, musicScorePageIndex: index,
      ...expectedMetadata, imageWidth: 800, imageHeight: 1200
    });
    assert.equal(await fs.readFile(path.join(h.directories.uploads, String(message.filePath)), "utf8"), `score-page-${71 + index}`);
  }
});

test("AI reply retries remain durable and each changed reply field conflicts before copying", async context => {
  const h = await harness(context);
  const reply = { messageId: 90, aiRole: "ai_slmm", activationMode: "direct", anchorMessageId: 89 };
  const input = { ...h.input, reply };
  const created = await h.service.share(input);
  const files = await fs.readdir(h.directories.uploads);
  await fs.rm(h.directories.scores, { recursive: true });
  assert.deepEqual(await h.service.share(input), { ...created, state: "replayed" });
  const restarted = createMusicScoreShareService(h.prisma, h.directories);
  assert.deepEqual(await restarted.share(input), { ...created, state: "replayed" });
  for (const changed of [
    undefined,
    { ...reply, messageId: 91 },
    { ...reply, aiRole: "why_assistant" },
    { ...reply, activationMode: "weak" },
    { ...reply, anchorMessageId: 88 }
  ]) {
    await assert.rejects(restarted.share({ ...h.input, reply: changed }), error =>
      error instanceof MusicScoreShareError && error.statusCode === 409);
  }
  assert.equal(h.messages.size, 2);
  assert.deepEqual(await fs.readdir(h.directories.uploads), files);
});

test("PDF replies retain their native file attachment and AI context", async context => {
  const h = await harness(context, true);
  await h.service.share({ ...h.input, reply: { messageId: 90, aiRole: "ai_slmm", activationMode: "weak", anchorMessageId: 80 } });
  const [message] = h.messages.values();
  assert.equal(message.type, "file");
  assert.equal(message.fileName, "歌谱-1.pdf");
  assert.equal(message.replyToId, 90);
  assert.deepEqual(message.payload, {
    sourceMusicScoreId: 7, musicScoreShareRequestId: h.input.clientRequestId, musicScorePageIndex: 0,
    aiRole: "ai_slmm", triggerMessageId: 90, aiActivationMode: "weak", activationAnchorMessageId: 80
  });
});
