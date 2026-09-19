import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import Fastify, { type FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import type { PrismaClient, Story, StoryComment, StoryLike, StoryMedia } from "@prisma/client";
import sharp from "sharp";
import { registerStoryRoutes } from "./stories.js";

type TestAccount = { id: number; isGuest: boolean; displayName: string; avatarPath: null; gender: string; storyBio?: string; role: "admin" | "user"; actor: { id: number } };
type LikeRow = StoryLike & { account: TestAccount };
type CommentRow = StoryComment & { account: TestAccount };
type Row = Story & { media: StoryMedia[]; likes: LikeRow[]; comments: CommentRow[] };
function payload(parts: Array<{ name: string; value: string | Buffer; mime?: string }>) {
  const boundary = `story-${crypto.randomUUID()}`;
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"${part.mime ? '; filename="sample.bin"' : ""}\r\n${part.mime ? `Content-Type: ${part.mime}\r\n` : ""}\r\n`));
    chunks.push(Buffer.isBuffer(part.value) ? part.value : Buffer.from(part.value));
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

async function harness() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "stories-test-"));
  const rows: Row[] = [];
  let shared = true;
  let nextId = 1;
  let nextMedia = 1;
  let nextLike = 1;
  let nextComment = 1;
  const bios = new Map<number, string>();
  const account = (id: number): TestAccount => ({ id, isGuest: id === 3, displayName: `Person ${id}`, avatarPath: null, gender: id === 1 ? "female" : "unspecified", storyBio: bios.get(id), role: id === 1 || id === 4 ? "admin" : "user", actor: { id } });
  const prisma = {
    account: {
      findUnique: async ({ where }: { where: { id: number } }) => account(where.id),
      update: async ({ where, data }: { where: { id: number }; data: { storyBio: string } }) => { bios.set(where.id, data.storyBio); return account(where.id); }
    },
    actor: { findUnique: async ({ where }: { where: { id: number } }) => ({ id: where.id, kind: "human", status: "active", account: account(where.id) }) },
    channel: { findFirst: async () => shared ? { id: 1 } : null },
    story: {
      findUnique: async ({ where }: { where: { id?: number; accountId_requestId?: { accountId: number; requestId: string } } }) => {
        const row = where.id ? rows.find((item) => item.id === where.id) : rows.find((item) => item.accountId === where.accountId_requestId?.accountId && item.requestId === where.accountId_requestId?.requestId);
        return row ? { ...row, account: account(row.accountId) } : null;
      },
      findFirst: async ({ where }: { where: { id: number; accountId: number } }) => rows.find((row) => row.id === where.id && row.accountId === where.accountId) || null,
      findMany: async ({ where, take }: { where: { accountId: number; id?: { lt: number } }; take: number }) => rows.filter((row) => row.accountId === where.accountId && (!where.id || row.id < where.id.lt)).sort((a, b) => b.id - a.id).slice(0, take),
      create: async ({ data }: { data: { accountId: number; requestId: string; text: string; media: { create: Omit<StoryMedia, "id" | "storyId">[] } } }) => {
        const id = nextId++;
        const row: Row = { id, accountId: data.accountId, requestId: data.requestId, text: data.text, createdAt: new Date(), media: data.media.create.map((item) => ({ ...item, storyId: id, id: nextMedia++ })), likes: [], comments: [] };
        rows.push(row);
        return row;
      },
      deleteMany: async ({ where }: { where: { id: number; accountId: number } }) => { const index = rows.findIndex((row) => row.id === where.id && row.accountId === where.accountId); if (index >= 0) rows.splice(index, 1); return { count: index >= 0 ? 1 : 0 }; }
    },
    storyLike: {
      upsert: async ({ where, create }: { where: { storyId_accountId: { storyId: number; accountId: number } }; create: { storyId: number; accountId: number } }) => {
        const row = rows.find((item) => item.id === where.storyId_accountId.storyId)!;
        let like = row.likes.find((item) => item.accountId === where.storyId_accountId.accountId);
        if (!like) { like = { id: nextLike++, ...create, createdAt: new Date(), account: account(create.accountId) }; row.likes.push(like); }
        return like;
      },
      deleteMany: async ({ where }: { where: { storyId: number; accountId: number } }) => {
        const row = rows.find((item) => item.id === where.storyId);
        const before = row?.likes.length || 0;
        if (row) row.likes = row.likes.filter((item) => item.accountId !== where.accountId);
        return { count: before - (row?.likes.length || 0) };
      }
    },
    storyComment: {
      create: async ({ data }: { data: { storyId: number; accountId: number; text: string } }) => {
        const row = rows.find((item) => item.id === data.storyId)!;
        const comment: CommentRow = { id: nextComment++, ...data, createdAt: new Date(), account: account(data.accountId) };
        row.comments.push(comment);
        return comment;
      },
      findFirst: async ({ where }: { where: { id: number; storyId: number } }) => rows.find((item) => item.id === where.storyId)?.comments.find((item) => item.id === where.id) || null,
      deleteMany: async ({ where }: { where: { id: number; storyId: number } }) => {
        const row = rows.find((item) => item.id === where.storyId);
        const before = row?.comments.length || 0;
        if (row) row.comments = row.comments.filter((item) => item.id !== where.id);
        return { count: before - (row?.comments.length || 0) };
      }
    },
    storyMedia: { findUnique: async ({ where }: { where: { id: number } }) => {
      for (const row of rows) {
        const media = row.media.find((item) => item.id === where.id);
        if (media) return { ...media, story: { ...row, account: { actor: { id: row.accountId } } } };
      }
      return null;
    } }
  } as unknown as PrismaClient;
  const app = Fastify();
  await app.register(multipart);
  const requireAuth = async (request: FastifyRequest) => {
    const id = Number(request.headers["x-account"] || 1);
    Object.assign(request, { auth: { accountId: id, actorId: id } });
  };
  registerStoryRoutes(app, { prisma, directory, requireAuth, requireMediaAuth: requireAuth });
  const image = await sharp({ create: { width: 12, height: 10, channels: 3, background: "#829979" } }).png().toBuffer();
  async function upload(requestId = crypto.randomUUID(), extras: Array<{ name: string; value: string | Buffer; mime?: string }> = [{ name: "image", value: image, mime: "image/png" }], headers?: Record<string, string>) {
    const body = payload([{ name: "requestId", value: requestId }, { name: "text", value: "留住这一刻" }, ...extras]);
    return app.inject({ method: "POST", url: "/api/stories", payload: body.payload, headers: { ...body.headers, ...headers } });
  }
  return { app, rows, directory, upload, image, setShared: (value: boolean) => { shared = value; }, cleanup: async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); } };
}

test("publish is atomic, text-only and invalid images are rejected without residual files", async () => {
  const h = await harness();
  try {
    for (const extras of [[], [{ name: "image", value: Buffer.from("not an image"), mime: "image/png" }], [{ name: "voice", value: Buffer.from("#EXTM3U\nfile:///etc/passwd"), mime: "audio/mpeg" }]]) {
      const response = await h.upload(crypto.randomUUID(), extras);
      assert.equal(response.statusCode, 400, response.body);
      assert.equal(h.rows.length, 0);
      assert.deepEqual(await fs.readdir(h.directory), []);
    }
  } finally { await h.cleanup(); }
});

test("upload retries return one story; media range, ownership and revocation are enforced", async () => {
  const h = await harness();
  try {
    const requestId = crypto.randomUUID();
    const first = await h.upload(requestId);
    assert.equal(first.statusCode, 201, first.body);
    const story = first.json().story;
    assert.equal((await h.upload(requestId)).json().story.id, story.id);
    assert.equal(h.rows.length, 1);
    assert.equal((await fs.readdir(h.directory)).length, 1);
    const mediaUrl = `/api/stories/media/${story.media[0].id}`;
    assert.equal((await h.app.inject({ url: mediaUrl, headers: { "x-account": "2" } })).statusCode, 200);
    const range = await h.app.inject({ url: mediaUrl, headers: { range: "bytes=0-9" } });
    assert.equal(range.statusCode, 206);
    assert.equal(range.rawPayload.length, 10);
    assert.equal(range.headers["cache-control"], "private, no-store");
    assert.equal((await h.app.inject({ url: mediaUrl, headers: { range: "bytes=999999-" } })).statusCode, 416);
    assert.equal((await h.app.inject({ method: "DELETE", url: `/api/stories/${story.id}`, headers: { "x-account": "2" } })).statusCode, 404);
    h.setShared(false);
    for (const url of [mediaUrl, "/api/stories?actorId=1", "/api/stories/authors/1"]) assert.equal((await h.app.inject({ url, headers: { "x-account": "2" } })).statusCode, 404);
    assert.equal((await h.app.inject({ url: "/api/stories?actorId=1" })).statusCode, 200);
    const storedPath = path.join(h.directory, h.rows[0].media[0].fileName);
    assert.equal((await h.app.inject({ method: "DELETE", url: `/api/stories/${story.id}` })).statusCode, 200);
    await assert.rejects(fs.stat(storedPath));
    assert.equal((await h.app.inject({ url: mediaUrl })).statusCode, 404);
  } finally { await h.cleanup(); }
});

test("photo count is enforced server-side and rejected batches leave no partial story", async () => {
  const h = await harness();
  try {
    const photo = { name: "image", value: h.image, mime: "image/png" };
    const accepted = await h.upload(crypto.randomUUID(), Array.from({ length: 9 }, () => photo));
    assert.equal(accepted.statusCode, 201, accepted.body);
    assert.equal(accepted.json().story.media.length, 9);
    const rejected = await h.upload(crypto.randomUUID(), Array.from({ length: 10 }, () => photo));
    assert.equal(rejected.statusCode, 400, rejected.body);
    assert.equal(h.rows.length, 1);
    assert.equal((await fs.readdir(h.directory)).length, 1);
  } finally { await h.cleanup(); }
});

test("HEIC is decoded to a browser-readable preview without publishing and can be published directly", async () => {
  const h = await harness();
  try {
    const heic = await fs.readFile(new URL("../../../e2e/fixtures/story-sample.heic", import.meta.url));
    const response = await h.app.inject({ method: "POST", url: "/api/stories/prepare-image", ...payload([{ name: "image", value: heic, mime: "image/heic" }]) });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.headers["cache-control"], "private, no-store");
    const preview = Buffer.from(response.json().base64, "base64");
    assert.equal((await sharp(preview).metadata()).format, "webp");
    assert.equal((await sharp(preview).metadata()).width, 80);
    assert.equal(h.rows.length, 0);
    const published = await h.upload(crypto.randomUUID(), [{ name: "image", value: heic, mime: "image/heic" }]);
    assert.equal(published.statusCode, 201, published.body);
    assert.equal(published.json().story.media[0].width, 80);
    const invalid = await h.app.inject({ method: "POST", url: "/api/stories/prepare-image", ...payload([{ name: "image", value: Buffer.from("invalid"), mime: "image/heic" }]) });
    assert.equal(invalid.statusCode, 400);
    assert.equal((await h.app.inject({ method: "POST", url: "/api/stories/prepare-image", headers: { "x-account": "3" } })).statusCode, 403);
  } finally { await h.cleanup(); }
});

test("story signature is owner-scoped, bounded and restores its default when blank", async () => {
  const h = await harness();
  try {
    const get = async () => (await h.app.inject({ url: "/api/stories/authors/1" })).json().author.bio;
    const patch = (bio: string, extra = {}) => h.app.inject({ method: "PATCH", url: "/api/stories/profile", payload: { bio, ...extra } });
    assert.equal(await get(), "小小的故事，大大的恩典");
    assert.equal((await patch(" 在每一天，记住恩典 ")).json().bio, "在每一天，记住恩典");
    assert.equal(await get(), "在每一天，记住恩典");
    assert.equal((await patch("a".repeat(161))).statusCode, 400);
    assert.equal((await patch("别人", { accountId: 2 })).statusCode, 400);
    assert.equal((await patch(" ")).json().bio, "小小的故事，大大的恩典");
    assert.equal((await h.app.inject({ method: "PATCH", url: "/api/stories/profile", headers: { "x-account": "3" }, payload: { bio: "访客" } })).statusCode, 403);
  } finally { await h.cleanup(); }
});

test("story likes and comments are persistent, idempotent and permission checked", async () => {
  const h = await harness();
  try {
    const story = (await h.upload()).json().story;
    const likeUrl = `/api/stories/${story.id}/like`;
    const commentUrl = `/api/stories/${story.id}/comments`;
    const asReader = { "x-account": "2" };
    const liked = await h.app.inject({ method: "PUT", url: likeUrl, headers: asReader, payload: { liked: true } });
    assert.equal(liked.statusCode, 200, liked.body);
    assert.equal(liked.json().interactions.liked, true);
    assert.equal(liked.json().interactions.likeCount, 1);
    assert.equal(liked.json().interactions.likes[0].displayName, "Person 2");
    assert.equal((await h.app.inject({ method: "PUT", url: likeUrl, headers: asReader, payload: { liked: true } })).json().interactions.likeCount, 1);

    const commented = await h.app.inject({ method: "POST", url: commentUrl, headers: asReader, payload: { text: "  愿你常有喜乐  " } });
    assert.equal(commented.statusCode, 201, commented.body);
    assert.equal(commented.json().interactions.comments[0].text, "愿你常有喜乐");
    assert.equal(commented.json().interactions.comments[0].canDelete, true);
    const commentId = commented.json().interactions.comments[0].id;
    assert.equal((await h.app.inject({ method: "POST", url: commentUrl, headers: asReader, payload: { text: " " } })).statusCode, 400);
    assert.equal((await h.app.inject({ method: "POST", url: commentUrl, headers: asReader, payload: { text: "a".repeat(501) } })).statusCode, 400);
    assert.equal((await h.app.inject({ method: "POST", url: commentUrl, headers: { "x-account": "3" }, payload: { text: "访客评论" } })).statusCode, 404);
    assert.equal((await h.app.inject({ method: "DELETE", url: `/api/stories/${story.id}/comments/${commentId}`, headers: { "x-account": "5" } })).statusCode, 404);
    const ownerDelete = await h.app.inject({ method: "DELETE", url: `/api/stories/${story.id}/comments/${commentId}` });
    assert.equal(ownerDelete.statusCode, 200, ownerDelete.body);
    assert.equal(ownerDelete.json().interactions.commentCount, 0);

    const unliked = await h.app.inject({ method: "PUT", url: likeUrl, headers: asReader, payload: { liked: false } });
    assert.equal(unliked.json().interactions.likeCount, 0);
    h.setShared(false);
    assert.equal((await h.app.inject({ method: "PUT", url: likeUrl, headers: asReader, payload: { liked: true } })).statusCode, 404);
    assert.equal((await h.app.inject({ method: "POST", url: commentUrl, headers: asReader, payload: { text: "看不见" } })).statusCode, 404);
    h.setShared(true);
    const otherStory = (await h.upload(crypto.randomUUID(), undefined, { "x-account": "2" })).json().story;
    const otherComment = await h.app.inject({ method: "POST", url: `/api/stories/${otherStory.id}/comments`, headers: { "x-account": "5" }, payload: { text: "管理员可处理" } });
    const otherCommentId = otherComment.json().interactions.comments[0].id;
    assert.equal((await h.app.inject({ method: "DELETE", url: `/api/stories/${otherStory.id}/comments/${otherCommentId}` })).statusCode, 200);
  } finally { await h.cleanup(); }
});

test("guest viewing/publishing denied and newest-first pages use a stable id cursor", async () => {
  const h = await harness();
  try {
    assert.equal((await h.app.inject({ url: "/api/stories?actorId=1", headers: { "x-account": "3" } })).statusCode, 404);
    assert.equal((await h.app.inject({ method: "POST", url: "/api/stories", headers: { "x-account": "3" } })).statusCode, 403);
    for (let i = 0; i < 22; i++) await h.upload();
    const page = (await h.app.inject({ url: "/api/stories?actorId=1" })).json();
    assert.equal(page.stories.length, 20);
    assert.equal(page.stories[0].id, 22);
    assert.equal(page.nextCursor, 3);
    const older = (await h.app.inject({ url: `/api/stories?actorId=1&before=${page.nextCursor}` })).json();
    assert.deepEqual(older.stories.map((row: { id: number }) => row.id), [2, 1]);
    assert.equal(older.nextCursor, null);
  } finally { await h.cleanup(); }
});
