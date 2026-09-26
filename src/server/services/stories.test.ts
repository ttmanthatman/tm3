import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { PrismaClient } from "@prisma/client";
import { createGraceStory } from "./stories.js";

test("grace stories allow text-only entries and copy attached media independently", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grace-story-test-"));
  const uploads = path.join(root, "uploads");
  const stories = path.join(root, "stories");
  await fs.mkdir(uploads, { recursive: true });
  const sourceName = "grace-photo.png";
  await sharp({ create: { width: 18, height: 12, channels: 3, background: "#7c9473" } })
    .png()
    .toFile(path.join(uploads, sourceName));

  const stored = new Map<string, { id: number; createdAt: Date }>();
  const createdData: Array<{
    accountId: number;
    requestId: string;
    text: string;
    media?: { create: Array<{ fileName: string; kind: string }> };
  }> = [];
  let nextId = 1;
  const prisma = {
    message: {
      findMany: async () => [{ id: 91, type: "image", payload: null, filePath: sourceName }]
    },
    story: {
      findUnique: async ({ where }: { where: { accountId_requestId: { accountId: number; requestId: string } } }) =>
        stored.get(`${where.accountId_requestId.accountId}:${where.accountId_requestId.requestId}`) || null,
      create: async ({ data }: { data: typeof createdData[number] }) => {
        createdData.push(data);
        const result = { id: nextId++, createdAt: new Date("2026-09-19T12:00:00.000Z") };
        stored.set(`${data.accountId}:${data.requestId}`, result);
        return result;
      }
    }
  } as unknown as PrismaClient;

  try {
    const textOnly = await createGraceStory(prisma, { stories, uploads }, {
      accountId: 2,
      graceMessageId: 41,
      content: "<p>今天<br>经历恩典</p>"
    });
    assert.equal(textOnly.created, true);
    assert.equal(createdData[0].text, "今天\n经历恩典");
    assert.equal(createdData[0].media, undefined);

    const withPhoto = await createGraceStory(prisma, { stories, uploads }, {
      accountId: 2,
      graceMessageId: 42,
      content: "有照片的恩典",
      imageMessageId: 91
    });
    assert.equal(withPhoto.created, true);
    const copiedName = createdData[1].media?.create[0]?.fileName;
    assert.ok(copiedName);
    const copiedPath = path.join(stories, copiedName);
    assert.equal((await sharp(copiedPath).metadata()).format, "webp");
    await fs.unlink(path.join(uploads, sourceName));
    assert.equal((await fs.stat(copiedPath)).isFile(), true);

    const repeated = await createGraceStory(prisma, { stories, uploads }, {
      accountId: 2,
      graceMessageId: 42,
      content: "不会重复创建",
      imageMessageId: 91
    });
    assert.equal(repeated.created, false);
    assert.equal(createdData.length, 2);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("new grace photos are copied independently without chat image messages", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grace-multi-story-"));
  const uploads = path.join(root, "uploads");
  const stories = path.join(root, "stories");
  await fs.mkdir(uploads);
  const names = ["00000000-0000-0000-0000-000000000001.webp", "00000000-0000-0000-0000-000000000002.webp"];
  for (const name of names) await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).webp().toFile(path.join(uploads, name));
  let data: { media?: { create: Array<{ fileName: string }> } } | undefined;
  const prisma = { story: { findUnique: async () => null, create: async (input: { data: typeof data }) => { data = input.data; return { id: 1, createdAt: new Date() }; } } } as unknown as PrismaClient;
  try {
    await createGraceStory(prisma, { stories, uploads }, { accountId: 2, graceMessageId: 41, content: "照片见证", imageFileNames: names });
    assert.equal(data?.media?.create.length, 2);
    await fs.rm(uploads, { recursive: true });
    for (const media of data!.media!.create) assert.equal((await sharp(path.join(stories, media.fileName)).metadata()).format, "webp");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
