import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { PrismaClient } from "@prisma/client";
import { GraceConflictError, saveGraceCard, type GraceSaveInput } from "./gracePersistence.js";
import { graceUpdateStoryText, prependGraceUpdateHistory } from "./graceUpdates.js";

function persistenceHarness(options: { conflict?: boolean; storyFails?: boolean; commitFails?: boolean } = {}) {
  const state = { content: "旧见证", messages: 0, stories: 0 };
  let expected: unknown;
  let transactions = 0;
  const transaction = {
    message: {
      updateMany: async (input: { where: unknown; data: { content: string } }) => { expected = input.where; state.content = input.data.content; return { count: options.conflict ? 0 : 1 }; },
      create: async () => { state.messages++; return { id: 88 }; }
    },
    story: {
      findUnique: async () => null,
      create: async () => { if (options.storyFails) throw new Error("story failed"); state.stories++; return { id: 1, createdAt: new Date() }; }
    }
  };
  const prisma = { $transaction: async (action: (tx: typeof transaction) => Promise<unknown>) => {
    transactions++;
    const before = { ...state };
    try { const result = await action(transaction); if (options.commitFails) throw new Error("commit failed"); return result; } catch (error) { Object.assign(state, before); throw error; }
  } } as unknown as PrismaClient;
  return { prisma, state, expected: () => expected, transactions: () => transactions };
}
const update: GraceSaveInput = { channelId: 7, actorId: 22, content: "新见证", payload: { kind: "grace" }, source: { id: 31, content: "旧见证", payload: { kind: "grace" } }, story: { accountId: 2, content: "恩典更新：新见证" } };

test("source edit, pushed card and incremental story share one transaction", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grace-persistence-"));
  const harness = persistenceHarness();
  try {
    await saveGraceCard(harness.prisma, { stories: root, uploads: root }, update);
    assert.deepEqual(harness.state, { content: "新见证", messages: 1, stories: 1 });
    assert.equal(harness.transactions(), 1);
    assert.deepEqual(harness.expected(), { id: 31, type: "grace", content: "旧见证", payload: { equals: { kind: "grace" } } });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("a concurrent edit aborts before creating another card or story", async () => {
  const harness = persistenceHarness({ conflict: true });
  await assert.rejects(saveGraceCard(harness.prisma, { stories: "unused", uploads: "unused" }, update), GraceConflictError);
  assert.deepEqual(harness.state, { content: "旧见证", messages: 0, stories: 0 });
});

test("story failure rolls back all database changes", async () => {
  const harness = persistenceHarness({ storyFails: true });
  await assert.rejects(saveGraceCard(harness.prisma, { stories: "unused", uploads: "unused" }, update), /story failed/);
  assert.deepEqual(harness.state, { content: "旧见证", messages: 0, stories: 0 });
});

test("incremental story text excludes unchanged lines and reports photo or deletion edits", () => {
  assert.equal(graceUpdateStoryText("原见证", "原见证\n后来康复了"), "恩典更新：\n后来康复了");
  assert.equal(graceUpdateStoryText("第一行\n旧内容", "第一行\n新内容"), "恩典更新：\n新内容");
  assert.equal(graceUpdateStoryText("第一行\n第二行", "第一行"), "恩典更新：\n已删减原有文字");
  assert.equal(graceUpdateStoryText("第一行", "第一行"), "恩典照片已更新");
});


test("a failed transaction commit cleans the independent story media copy", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grace-commit-cleanup-"));
  const uploads = path.join(root, "uploads");
  const stories = path.join(root, "stories");
  await fs.mkdir(uploads);
  await fs.mkdir(stories);
  const fileName = "00000000-0000-0000-0000-000000000001.webp";
  await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).webp().toFile(path.join(uploads, fileName));
  const harness = persistenceHarness({ commitFails: true });
  try {
    await assert.rejects(saveGraceCard(harness.prisma, { stories, uploads }, { ...update, story: { ...update.story!, imageFileNames: [fileName] } }), /commit failed/);
    assert.deepEqual(await fs.readdir(stories), []);
    assert.deepEqual(harness.state, { content: "旧见证", messages: 0, stories: 0 });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});


test("grace history keeps the correct photos for blank voice-only entries and skips malformed rows", () => {
  const image = { fileName: "00000000-0000-0000-0000-000000000001.webp", width: 8, height: 8 };
  const history = prependGraceUpdateHistory({ images: [image], updates: [null, { content: "", at: "voice", images: [image] }, { content: "旧文字", at: "text", images: [] }] }, "新文字", "now", "作者");
  assert.equal(history.length, 3);
  assert.deepEqual(history[0].images, [image]);
  assert.equal(history[1].content, "");
  assert.deepEqual(history[1].images, [image]);
  assert.deepEqual(history[2].images, []);
});
