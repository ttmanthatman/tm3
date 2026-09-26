import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { createStoryGraceService, storyGraceContent, type StoryGraceInput } from "./storyGrace.js";
import { graceMediaFiles, graceNativeVoice } from "../../shared/grace.js";

interface StoredCard { id: number; clientRequestHash: string; payload: Prisma.InputJsonObject; content: string; type: string }
async function harness(kinds: Array<"image" | "voice"> = [], options: { text?: string; missingLast?: boolean; commitFails?: boolean } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "story-grace-test-"));
  const directories = { stories: path.join(root, "stories"), uploads: path.join(root, "uploads") };
  const folder = crypto.randomUUID();
  await fs.mkdir(path.join(directories.stories, folder), { recursive: true });
  await fs.mkdir(directories.uploads);
  const media = kinds.map((kind, position) => ({ kind, position, fileName: `${folder}/${crypto.randomUUID()}.${kind === "image" ? "webp" : "m4a"}`, width: kind === "image" ? 12 : null, height: kind === "image" ? 8 : null, durationMs: kind === "voice" ? 1500 : null }));
  for (const [index, item] of media.entries()) if (!options.missingLast || index !== media.length - 1) await fs.writeFile(path.join(directories.stories, item.fileName), `source-${index}`);
  let source: { id: number; text: string; media: typeof media } | null = { id: 17, text: options.text ?? "故事 & <记忆>\n第二行", media };
  const cards = new Map<string, StoredCard>();
  const transaction = { message: { create: async ({ data }: { data: { clientRequestId: string; clientRequestHash: string; payload: Prisma.InputJsonObject; content: string; type: string } }) => {
    if (cards.has(data.clientRequestId)) throw new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" });
    const card = { ...data, id: cards.size + 1 };
    cards.set(data.clientRequestId, card);
    return card;
  } } };
  const prisma = {
    story: { findFirst: async ({ where }: { where: { id: number; accountId: number } }) => where.id === 17 && where.accountId === 2 ? source : null },
    message: { findUnique: async ({ where }: { where: { senderActorId_clientRequestId: { clientRequestId: string } } }) => cards.get(where.senderActorId_clientRequestId.clientRequestId) || null },
    $transaction: async (action: (tx: typeof transaction) => Promise<unknown>) => {
      const before = new Map(cards);
      try { const value = await action(transaction); if (options.commitFails) throw new Error("commit failed"); return value; }
      catch (error) { if (options.commitFails) { cards.clear(); for (const [key, value] of before) cards.set(key, value); } throw error; }
    }
  } as unknown as PrismaClient;
  const input: StoryGraceInput = { accountId: 2, actorId: 22, storyId: 17, channelId: 7, clientRequestId: crypto.randomUUID() };
  return { root, directories, media, cards, prisma, input, service: createStoryGraceService(prisma, directories), removeSource: () => { source = null; } };
}

test("story text is escaped once and line breaks are preserved", () => {
  assert.equal(storyGraceContent('<script>"&\'</script>\r\n下一行'), "&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;<br />下一行");
});

test("text-only, nine photos, voice-only and mixed stories create one independent grace snapshot", async () => {
  for (const kinds of [[], Array<"image">(9).fill("image"), ["voice"], ["image", "voice"]] as Array<Array<"image" | "voice">>) {
    const h = await harness(kinds, { text: kinds.length ? "" : "纯文字" });
    try {
      const result = await h.service.forward(h.input);
      assert.equal(result.state, "created");
      assert.equal(h.cards.size, 1);
      const card = h.cards.get(h.input.clientRequestId)!;
      assert.equal(card.type, "grace");
      assert.equal(card.payload.sourceStoryId, 17);
      assert.equal(graceMediaFiles(card.payload).length, kinds.length);
      const files = graceMediaFiles(card.payload);
      for (const [index, file] of files.entries()) assert.equal(await fs.readFile(path.join(h.directories.uploads, file), "utf8"), `source-${index}`);
      if (kinds.includes("voice")) assert.equal(graceNativeVoice(card.payload)?.durationMs, 1500);
      await fs.rm(h.directories.stories, { recursive: true });
      for (const file of files) await fs.access(path.join(h.directories.uploads, file));
    } finally { await fs.rm(h.root, { recursive: true, force: true }); }
  }
});

test("retry and concurrent requests reuse one card; a fresh request can forward again", async () => {
  const h = await harness(["image", "voice"]);
  try {
    const [first, concurrent] = await Promise.all([h.service.forward(h.input), h.service.forward(h.input)]);
    assert.equal(first.state, "created");
    assert.equal(concurrent.state, "replayed");
    assert.equal(first.messageId, concurrent.messageId);
    h.removeSource();
    assert.equal((await h.service.forward(h.input)).state, "replayed", "a retry survives source deletion");
    assert.equal(h.cards.size, 1);
    assert.equal((await fs.readdir(h.directories.uploads)).length, 2);
    await assert.rejects(h.service.forward({ ...h.input, channelId: 8 }), (error: Error & { statusCode?: number }) => error.statusCode === 409);
  } finally { await fs.rm(h.root, { recursive: true, force: true }); }
  const fresh = await harness();
  try {
    await fresh.service.forward(fresh.input);
    await fresh.service.forward({ ...fresh.input, clientRequestId: crypto.randomUUID() });
    assert.equal(fresh.cards.size, 2);
  } finally { await fs.rm(fresh.root, { recursive: true, force: true }); }
});

test("a database uniqueness race between service instances cleans the losing file copies", async () => {
  const h = await harness(["image", "voice"]);
  try {
    const other = createStoryGraceService(h.prisma, h.directories);
    const results = await Promise.all([h.service.forward(h.input), other.forward(h.input)]);
    assert.deepEqual(results.map((result) => result.state).sort(), ["created", "replayed"]);
    assert.equal(h.cards.size, 1);
    assert.equal((await fs.readdir(h.directories.uploads)).length, 2);
  } finally { await fs.rm(h.root, { recursive: true, force: true }); }
});

test("missing attachments and failed commits leave no card or upload copies", async () => {
  for (const options of [{ missingLast: true }, { commitFails: true }]) {
    const h = await harness(["image", "voice"], options);
    try {
      await assert.rejects(h.service.forward(h.input), options.missingLast ? /附件已不可用/ : /commit failed/);
      assert.equal(h.cards.size, 0);
      assert.deepEqual(await fs.readdir(h.directories.uploads), []);
      await fs.access(path.join(h.directories.stories, h.media[0].fileName));
    } finally { await fs.rm(h.root, { recursive: true, force: true }); }
  }
});

test("another account's story and an empty source cannot be forwarded", async () => {
  const h = await harness([], { text: "" });
  try {
    await assert.rejects(h.service.forward({ ...h.input, accountId: 3 }), (error: Error & { statusCode?: number }) => error.statusCode === 404);
    await assert.rejects(h.service.forward(h.input), (error: Error & { statusCode?: number }) => error.statusCode === 400);
    assert.equal(h.cards.size, 0);
    assert.deepEqual(await fs.readdir(h.directories.uploads), []);
  } finally { await fs.rm(h.root, { recursive: true, force: true }); }
});
