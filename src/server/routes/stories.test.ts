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

type TestAccount = { id: number; isGuest: boolean; displayName: string; avatarPath: null; gender: string; storyBio?: string; storyFeedReadAt: Date; storyInteractionReadAt: Date; role: "admin" | "user"; actor: { id: number } };
type LikeRow = StoryLike & { account: TestAccount };
type CommentReplyRow = StoryComment & { account: TestAccount };
type CommentRow = CommentReplyRow & { replyTo: CommentReplyRow | null };
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
  const feedReads = new Map<number, Date>();
  const interactionReads = new Map<number, Date>();
  const account = (id: number): TestAccount => ({ id, isGuest: id === 3, displayName: `Person ${id}`, avatarPath: null, gender: id === 1 ? "female" : "unspecified", storyBio: bios.get(id), storyFeedReadAt: feedReads.get(id) || new Date(0), storyInteractionReadAt: interactionReads.get(id) || new Date(0), role: id === 1 || id === 4 ? "admin" : "user", actor: { id } });
  const storyEvents: Array<{ accountIds: number[]; storyId: number }> = [];
  const interactionEvents: Array<{ accountId: number; notification: { id: string; kind: string } }> = [];
  const announcements: Array<{ channelId: number; actorId: number; storyId: number; displayName: string }> = [];
  const prisma = {
    account: {
      findUnique: async ({ where }: { where: { id: number } }) => account(where.id),
      findMany: async () => [1, 2, 4, 5].map(account),
      update: async ({ where, data }: { where: { id: number }; data: { storyBio?: string; storyFeedReadAt?: Date; storyInteractionReadAt?: Date } }) => {
        if (data.storyBio !== undefined) bios.set(where.id, data.storyBio);
        if (data.storyFeedReadAt) feedReads.set(where.id, data.storyFeedReadAt);
        if (data.storyInteractionReadAt) interactionReads.set(where.id, data.storyInteractionReadAt);
        return account(where.id);
      }
    },
    actor: { findUnique: async ({ where }: { where: { id: number } }) => ({ id: where.id, kind: "human", status: "active", account: account(where.id) }) },
    channel: { findFirst: async () => shared ? { id: 1 } : null, findMany: async () => [] },
    story: {
      findUnique: async ({ where }: { where: { id?: number; accountId_requestId?: { accountId: number; requestId: string } } }) => {
        const row = where.id ? rows.find((item) => item.id === where.id) : rows.find((item) => item.accountId === where.accountId_requestId?.accountId && item.requestId === where.accountId_requestId?.requestId);
        return row ? { ...row, account: account(row.accountId) } : null;
      },
      findFirst: async ({ where }: { where: { id?: number; accountId: number | { in?: number[]; not?: number }; createdAt?: { gt: Date } } }) => rows.find((row) => {
        const accountMatches = typeof where.accountId === "number" ? row.accountId === where.accountId : (!where.accountId.in || where.accountId.in.includes(row.accountId)) && row.accountId !== where.accountId.not;
        return accountMatches && (!where.id || row.id === where.id) && (!where.createdAt || row.createdAt > where.createdAt.gt);
      }) || null,
      findMany: async ({ where, take }: { where: { accountId: number | { in: number[] }; id?: { lt: number } }; take: number }) => rows.filter((row) => {
        const accountMatches = typeof where.accountId === "number" ? row.accountId === where.accountId : where.accountId.in.includes(row.accountId);
        return accountMatches && (!where.id || row.id < where.id.lt);
      }).sort((a, b) => b.id - a.id).slice(0, take).map((row) => ({ ...row, account: account(row.accountId) })),
      create: async ({ data }: { data: { accountId: number; requestId: string; text: string; media: { create: Omit<StoryMedia, "id" | "storyId">[] } } }) => {
        const id = nextId++;
        const row: Row = { id, accountId: data.accountId, requestId: data.requestId, text: data.text, createdAt: new Date(), media: data.media.create.map((item) => ({ ...item, storyId: id, id: nextMedia++ })), likes: [], comments: [] };
        rows.push(row);
        return row;
      },
      deleteMany: async ({ where }: { where: { id: number; accountId: number } }) => { const index = rows.findIndex((row) => row.id === where.id && row.accountId === where.accountId); if (index >= 0) rows.splice(index, 1); return { count: index >= 0 ? 1 : 0 }; }
    },
    storyLike: {
      findUnique: async ({ where }: { where: { storyId_accountId: { storyId: number; accountId: number } } }) => rows.find((item) => item.id === where.storyId_accountId.storyId)?.likes.find((item) => item.accountId === where.storyId_accountId.accountId) || null,
      findMany: async ({ where, take }: { where: { accountId: { not: number }; createdAt: { gt: Date }; story: { accountId: number } }; take: number }) => rows.filter((story) => story.accountId === where.story.accountId).flatMap((story) => story.likes).filter((like) => like.accountId !== where.accountId.not && like.createdAt > where.createdAt.gt).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, take),
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
      findMany: async ({ where, take }: {
        where: {
          accountId: { not: number };
          createdAt: { gt: Date };
          story?: { accountId: number };
          OR?: Array<{ story?: { accountId: number }; replyTo?: { accountId: number } }>;
        };
        take: number;
      }) => rows.flatMap((story) => story.comments.map((comment) => ({ story, comment }))).filter(({ story, comment }) => {
        const visibleToRecipient = where.OR
          ? where.OR.some((clause) => clause.story
              ? clause.story.accountId === story.accountId
              : clause.replyTo
                ? clause.replyTo.accountId === comment.replyTo?.accountId
                : false)
          : where.story?.accountId === story.accountId;
        return visibleToRecipient && comment.accountId !== where.accountId.not && comment.createdAt > where.createdAt.gt;
      }).map(({ comment }) => comment).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, take),
      create: async ({ data }: { data: { storyId: number; accountId: number; text: string; replyToId?: number } }) => {
        const row = rows.find((item) => item.id === data.storyId)!;
        const replyTo = data.replyToId ? row.comments.find((item) => item.id === data.replyToId) || null : null;
        const comment: CommentRow = {
          id: nextComment++,
          storyId: data.storyId,
          accountId: data.accountId,
          replyToId: replyTo?.id || null,
          text: data.text,
          createdAt: new Date(),
          account: account(data.accountId),
          replyTo
        };
        row.comments.push(comment);
        return comment;
      },
      findFirst: async ({ where }: { where: { id: number; storyId: number } }) => rows.find((item) => item.id === where.storyId)?.comments.find((item) => item.id === where.id) || null,
      deleteMany: async ({ where }: { where: { id: number; storyId: number } }) => {
        const row = rows.find((item) => item.id === where.storyId);
        const before = row?.comments.length || 0;
        if (row) {
          row.comments = row.comments.filter((item) => item.id !== where.id);
          for (const item of row.comments) {
            if (item.replyToId === where.id) {
              item.replyToId = null;
              item.replyTo = null;
            }
          }
        }
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
  registerStoryRoutes(app, {
    prisma,
    directory,
    requireAuth,
    requireMediaAuth: requireAuth,
    announceStory: async (event) => { announcements.push(event); },
    notifyStoryPublished: (accountIds, event) => { storyEvents.push({ accountIds, storyId: event.storyId }); },
    notifyStoryInteraction: (accountId, notification) => { interactionEvents.push({ accountId, notification }); }
  });
  const image = await sharp({ create: { width: 12, height: 10, channels: 3, background: "#829979" } }).png().toBuffer();
  async function upload(requestId = crypto.randomUUID(), extras: Array<{ name: string; value: string | Buffer; mime?: string }> = [{ name: "image", value: image, mime: "image/png" }], headers?: Record<string, string>) {
    const body = payload([{ name: "requestId", value: requestId }, { name: "text", value: "留住这一刻" }, ...extras]);
    return app.inject({ method: "POST", url: "/api/stories", payload: body.payload, headers: { ...body.headers, ...headers } });
  }
  return { app, rows, directory, upload, image, storyEvents, interactionEvents, announcements, setShared: (value: boolean) => { shared = value; }, cleanup: async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); } };
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
    assert.equal(commented.json().interactions.comments[0].replyTo, null);
    const commentId = commented.json().interactions.comments[0].id;
    const replied = await h.app.inject({ method: "POST", url: commentUrl, payload: { text: "谢谢你的祝福", replyToId: commentId } });
    assert.equal(replied.statusCode, 201, replied.body);
    assert.equal(replied.json().interactions.comments[1].replyTo.id, commentId);
    assert.equal(replied.json().interactions.comments[1].replyTo.author.displayName, "Person 2");
    assert.deepEqual(h.interactionEvents.filter((event) => event.notification.kind === "comment").map((event) => event.accountId), [1, 2]);
    const replyActivity = (await h.app.inject({ url: "/api/stories/activity", headers: asReader })).json();
    assert.equal(replyActivity.notifications[0].text, "谢谢你的祝福");
    assert.equal((await h.app.inject({ method: "POST", url: commentUrl, payload: { text: "无效回复", replyToId: 9999 } })).statusCode, 400);
    assert.equal((await h.app.inject({ method: "POST", url: commentUrl, headers: asReader, payload: { text: " " } })).statusCode, 400);
    assert.equal((await h.app.inject({ method: "POST", url: commentUrl, headers: asReader, payload: { text: "a".repeat(501) } })).statusCode, 400);
    assert.equal((await h.app.inject({ method: "POST", url: commentUrl, headers: { "x-account": "3" }, payload: { text: "访客评论" } })).statusCode, 404);
    assert.equal((await h.app.inject({ method: "DELETE", url: `/api/stories/${story.id}/comments/${commentId}`, headers: { "x-account": "5" } })).statusCode, 404);
    const ownerDelete = await h.app.inject({ method: "DELETE", url: `/api/stories/${story.id}/comments/${commentId}` });
    assert.equal(ownerDelete.statusCode, 200, ownerDelete.body);
    assert.equal(ownerDelete.json().interactions.commentCount, 1);
    assert.equal(ownerDelete.json().interactions.comments[0].replyTo, null);
    const replyId = ownerDelete.json().interactions.comments[0].id;
    const replyDelete = await h.app.inject({ method: "DELETE", url: `/api/stories/${story.id}/comments/${replyId}` });
    assert.equal(replyDelete.json().interactions.commentCount, 0);

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

test("shared feed merges authors, story activity persists, and publishing announces in chat", async () => {
  const h = await harness();
  try {
    const first = await h.upload(crypto.randomUUID(), [
      { name: "channelId", value: "7" },
      { name: "image", value: h.image, mime: "image/png" }
    ]);
    const second = await h.upload(crypto.randomUUID(), undefined, { "x-account": "2" });
    assert.equal(first.statusCode, 201, first.body);
    assert.equal(second.statusCode, 201, second.body);
    assert.deepEqual(h.announcements, [{ channelId: 7, actorId: 1, storyId: 1, displayName: "Person 1" }]);
    assert.equal(h.storyEvents.length, 2);
    assert.ok(h.storyEvents[0].accountIds.includes(2));
    assert.ok(!h.storyEvents[0].accountIds.includes(1));

    const feed = (await h.app.inject({ url: "/api/stories/feed" })).json();
    assert.deepEqual(feed.stories.map((story: { id: number }) => story.id), [2, 1]);
    assert.deepEqual(feed.stories.map((story: { author: { displayName: string } }) => story.author.displayName), ["Person 2", "Person 1"]);
    assert.equal(feed.viewer.own, true);
    assert.equal((await h.app.inject({ url: "/api/stories/activity" })).json().hasUnreadStories, true);

    const storyId = first.json().story.id;
    await h.app.inject({ method: "PUT", url: `/api/stories/${storyId}/like`, headers: { "x-account": "2" }, payload: { liked: true } });
    await h.app.inject({ method: "POST", url: `/api/stories/${storyId}/comments`, headers: { "x-account": "2" }, payload: { text: "真好" } });
    assert.deepEqual(h.interactionEvents.map((event) => [event.accountId, event.notification.kind]), [[1, "like"], [1, "comment"]]);
    const activity = (await h.app.inject({ url: "/api/stories/activity" })).json();
    assert.equal(activity.notifications.length, 2);
    assert.equal(activity.notifications[0].actor.displayName, "Person 2");

    const read = await h.app.inject({ method: "PATCH", url: "/api/stories/activity/read", payload: { scope: "all" } });
    assert.equal(read.statusCode, 200, read.body);
    assert.equal(read.json().hasUnreadStories, false);
    assert.deepEqual(read.json().notifications, []);
  } finally { await h.cleanup(); }
});
