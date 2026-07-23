/// <reference types="node" />

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import Fastify from "fastify";
import type { FriendCategoryDTO, FriendPlaybackDTO, FriendProgramDTO } from "../../shared/types.js";
import type { FriendFeedService } from "../friendFeed.js";
import { registerFriendRoutes } from "./friend.js";

const AUDIO_URL = "https://txly2.net/ly/audio/2022/hp/hp220311.mp3";

function sampleProgram(): FriendProgramDTO {
  return {
    id: "89386",
    seriesId: "489",
    seriesTitle: "星动一刻",
    title: "星动一刻-20220311",
    date: "2022-03-11",
    audioUrl: `/api/friend/media?u=${encodeURIComponent(AUDIO_URL)}`
  };
}

function samplePlaybackRow() {
  return {
    accountId: 1,
    programId: "195414",
    seriesTitle: "书香园地",
    title: "少忧虑，多祷告",
    audioUrl: "https://txly2.net/ly/audio/2026/bc/bc260723.mp3",
    imageUrl: null,
    progressMs: 61_000,
    durationMs: 1_500_000,
    playedAt: new Date("2026-07-23T01:00:00.000Z")
  };
}

function createHarness(options: {
  programs?: FriendProgramDTO[];
  programsError?: Error;
  categories?: FriendCategoryDTO[];
  categoriesError?: Error;
  seriesPrograms?: FriendProgramDTO[];
  seriesError?: Error;
  historyRows?: ReturnType<typeof samplePlaybackRow>[];
  mediaBody?: Uint8Array;
  mediaStatus?: number;
  mediaError?: Error;
} = {}) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "friend-routes-"));
  const state = {
    lastRange: null as string | null,
    lastAlias: null as string | null,
    upserts: [] as Array<{ create: Record<string, unknown>; update: Record<string, unknown> }>,
    stored: [] as Array<{ url: string; size: number | null }>
  };
  const feedService: FriendFeedService = {
    async getPrograms() {
      if (options.programsError) throw options.programsError;
      return options.programs ?? [sampleProgram()];
    },
    async getCategories() {
      if (options.categoriesError) throw options.categoriesError;
      return options.categories ?? [{
        id: "6",
        title: "生活智慧",
        series: [{ id: "2", alias: "bc", title: "书香园地", description: "陪你读好书" }]
      }];
    },
    async getSeriesPrograms(alias: string) {
      state.lastAlias = alias;
      if (options.seriesError) throw options.seriesError;
      if (!/^[a-z0-9]{1,32}$/i.test(alias)) throw new Error("不支持的节目系列");
      return options.seriesPrograms ?? [sampleProgram()];
    },
    async refreshAll() {},
    isAllowedMediaUrl: (raw: string) =>
      raw.startsWith("https://txly2.net/ly/audio/")
      || raw.startsWith("https://txly2.net/images/")
      || raw.startsWith("https://d3ml8yyp1h3hy5.cloudfront.net/ly/image/cover/"),
    async fetchMediaStream(raw: string, range?: string | null) {
      state.lastRange = range ?? null;
      if (options.mediaError) throw options.mediaError;
      const body = options.mediaBody ?? new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      if (range === "bytes=2-4") {
        return {
          status: 206,
          contentType: "audio/mpeg",
          contentLength: 3,
          contentRange: `bytes 2-4/${body.byteLength}`,
          body: new Response(body.slice(2, 5)).body as ReadableStream<Uint8Array>
        };
      }
      return {
        status: options.mediaStatus ?? 200,
        contentType: "audio/mpeg",
        contentLength: body.byteLength,
        contentRange: null,
        body: new Response(body.slice()).body as ReadableStream<Uint8Array>
      };
    },
    resolveCachedMedia(raw: string) {
      const key = Buffer.from(raw).toString("hex").slice(0, 8);
      const filePath = path.join(scratch, `${key}.bin`);
      if (!fs.existsSync(filePath)) return null;
      return { filePath, contentType: "audio/mpeg", size: fs.statSync(filePath).size };
    },
    isCachingMedia: () => false,
    async storeMediaStream(raw: string, _contentType: string, expectedSize: number | null, body: ReadableStream<Uint8Array>) {
      state.stored.push({ url: raw, size: expectedSize });
      const key = Buffer.from(raw).toString("hex").slice(0, 8);
      const chunks: Buffer[] = [];
      for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
      fs.writeFileSync(path.join(scratch, `${key}.bin`), Buffer.concat(chunks));
    }
  };
  const prisma = {
    friendPlayback: {
      findMany: async () => options.historyRows ?? [samplePlaybackRow()],
      upsert: async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        state.upserts.push({ create: args.create, update: args.update });
        return { ...samplePlaybackRow(), ...args.create, ...args.update, playedAt: new Date("2026-07-23T02:00:00.000Z") };
      }
    }
  } as unknown as PrismaClient;
  const app = Fastify();
  registerFriendRoutes(app, {
    requireAuth: async (request) => {
      (request as unknown as { auth: unknown }).auth = { accountId: 1, actorId: 1, username: "tester", isAdmin: false, canPinMessages: false, sessionId: "s1" };
    },
    requireMediaAuth: async () => undefined,
    feedService,
    prisma
  });
  return { app, state, scratch };
}

test("GET /api/friend/programs 返回节目列表", async (context) => {
  const { app, scratch } = createHarness();
  context.after(() => Promise.all([app.close(), fs.promises.rm(scratch, { recursive: true, force: true })]));
  const response = await app.inject({ method: "GET", url: "/api/friend/programs" });
  assert.equal(response.statusCode, 200);
  const body = response.json() as { programs: FriendProgramDTO[] };
  assert.equal(body.programs.length, 1);
  assert.equal(body.programs[0].id, "89386");
});

test("GET /api/friend/programs 抓取失败时返回 502", async (context) => {
  const { app, scratch } = createHarness({ programsError: new Error("network down") });
  context.after(() => Promise.all([app.close(), fs.promises.rm(scratch, { recursive: true, force: true })]));
  const response = await app.inject({ method: "GET", url: "/api/friend/programs" });
  assert.equal(response.statusCode, 502);
  assert.match(response.body, /节目单暂时无法获取/);
});

test("GET /api/friend/categories 返回分类列表，失败时返回 502", async (context) => {
  const { app, scratch } = createHarness();
  context.after(() => Promise.all([app.close(), fs.promises.rm(scratch, { recursive: true, force: true })]));
  const response = await app.inject({ method: "GET", url: "/api/friend/categories" });
  assert.equal(response.statusCode, 200);
  const body = response.json() as { categories: FriendCategoryDTO[] };
  assert.equal(body.categories.length, 1);
  assert.equal(body.categories[0].series[0].alias, "bc");

  const failing = createHarness({ categoriesError: new Error("network down") });
  context.after(() => Promise.all([failing.app.close(), fs.promises.rm(failing.scratch, { recursive: true, force: true })]));
  const failed = await failing.app.inject({ method: "GET", url: "/api/friend/categories" });
  assert.equal(failed.statusCode, 502);
  assert.match(failed.body, /节目分类暂时无法获取/);
});

test("GET /api/friend/series/:alias 返回系列节目，非法别名返回 400，失败返回 502", async (context) => {
  const { app, state, scratch } = createHarness();
  context.after(() => Promise.all([app.close(), fs.promises.rm(scratch, { recursive: true, force: true })]));
  const response = await app.inject({ method: "GET", url: "/api/friend/series/ct" });
  assert.equal(response.statusCode, 200);
  assert.equal(state.lastAlias, "ct");
  const body = response.json() as { programs: FriendProgramDTO[] };
  assert.equal(body.programs[0].id, "89386");

  const invalid = await app.inject({ method: "GET", url: "/api/friend/series/bad%2Falias" });
  assert.equal(invalid.statusCode, 400);
  assert.match(invalid.body, /不支持的节目系列/);

  const failing = createHarness({ seriesError: new Error("upstream down") });
  context.after(() => Promise.all([failing.app.close(), fs.promises.rm(failing.scratch, { recursive: true, force: true })]));
  const failed = await failing.app.inject({ method: "GET", url: "/api/friend/series/ct" });
  assert.equal(failed.statusCode, 502);
  assert.match(failed.body, /节目列表暂时无法获取/);
});

test("GET /api/friend/history 返回最近收听列表（媒体地址包装为代理）", async (context) => {
  const { app, scratch } = createHarness();
  context.after(() => Promise.all([app.close(), fs.promises.rm(scratch, { recursive: true, force: true })]));
  const response = await app.inject({ method: "GET", url: "/api/friend/history" });
  assert.equal(response.statusCode, 200);
  const body = response.json() as { history: FriendPlaybackDTO[] };
  assert.equal(body.history.length, 1);
  assert.equal(body.history[0].programId, "195414");
  assert.equal(body.history[0].progressMs, 61_000);
  assert.equal(
    body.history[0].audioUrl,
    `/api/friend/media?u=${encodeURIComponent("https://txly2.net/ly/audio/2026/bc/bc260723.mp3")}`
  );
  assert.equal(body.history[0].imageUrl, undefined);
});

test("PUT /api/friend/playback/:programId 解包代理地址并落库", async (context) => {
  const { app, state, scratch } = createHarness();
  context.after(() => Promise.all([app.close(), fs.promises.rm(scratch, { recursive: true, force: true })]));
  const upstream = "https://txly2.net/ly/audio/2026/bc/bc260723.mp3";
  const response = await app.inject({
    method: "PUT",
    url: "/api/friend/playback/195414",
    payload: {
      seriesTitle: "书香园地",
      title: "少忧虑，多祷告",
      audioUrl: `/api/friend/media?u=${encodeURIComponent(upstream)}`,
      imageUrl: null,
      progressMs: 61_000,
      durationMs: 1_500_000
    }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(state.upserts.length, 1);
  assert.equal(state.upserts[0].create.accountId, 1);
  assert.equal(state.upserts[0].create.audioUrl, upstream);
  assert.equal(state.upserts[0].update.progressMs, 61_000);
  const body = response.json() as { success: boolean; playback: FriendPlaybackDTO };
  assert.equal(body.success, true);
  assert.equal(body.playback.programId, "195414");
});

test("PUT /api/friend/playback/:programId 拒绝非法编号与非白名单媒体地址", async (context) => {
  const { app, state, scratch } = createHarness();
  context.after(() => Promise.all([app.close(), fs.promises.rm(scratch, { recursive: true, force: true })]));
  const badId = await app.inject({
    method: "PUT",
    url: "/api/friend/playback/abc",
    payload: { seriesTitle: "s", title: "t", audioUrl: "https://txly2.net/ly/audio/x.mp3", progressMs: 0, durationMs: 0 }
  });
  assert.equal(badId.statusCode, 400);
  const evil = await app.inject({
    method: "PUT",
    url: "/api/friend/playback/195414",
    payload: { seriesTitle: "s", title: "t", audioUrl: "https://evil.example.com/x.mp3", progressMs: 0, durationMs: 0 }
  });
  assert.equal(evil.statusCode, 400);
  assert.equal(state.upserts.length, 0);
});

test("GET /api/friend/media 拒绝缺失或不在白名单的地址", async (context) => {
  const { app, scratch } = createHarness();
  context.after(() => Promise.all([app.close(), fs.promises.rm(scratch, { recursive: true, force: true })]));
  const missing = await app.inject({ method: "GET", url: "/api/friend/media" });
  assert.equal(missing.statusCode, 400);
  const evil = await app.inject({ method: "GET", url: `/api/friend/media?u=${encodeURIComponent("https://evil.example.com/x.mp3")}` });
  assert.equal(evil.statusCode, 403);
});

test("GET /api/friend/media 未命中缓存时透传 Range 并回写 206", async (context) => {
  const { app, state, scratch } = createHarness();
  context.after(() => Promise.all([app.close(), fs.promises.rm(scratch, { recursive: true, force: true })]));
  const response = await app.inject({
    method: "GET",
    url: `/api/friend/media?u=${encodeURIComponent(AUDIO_URL)}`,
    headers: { range: "bytes=2-4" }
  });
  assert.equal(state.lastRange, "bytes=2-4");
  assert.equal(response.statusCode, 206);
  assert.equal(response.headers["content-range"], "bytes 2-4/8");
  assert.equal(response.headers["content-type"], "audio/mpeg");
  assert.equal(response.body, Buffer.from([3, 4, 5]).toString("binary"));
  assert.equal(state.stored.length, 0, "Range 请求不应写入缓存");
});

test("GET /api/friend/media 完整请求流式转发并落盘缓存，再次请求走本地缓存", async (context) => {
  const payload = new Uint8Array([10, 11, 12, 13, 14, 15]);
  const { app, state, scratch } = createHarness({ mediaBody: payload });
  context.after(() => Promise.all([app.close(), fs.promises.rm(scratch, { recursive: true, force: true })]));
  const first = await app.inject({ method: "GET", url: `/api/friend/media?u=${encodeURIComponent(AUDIO_URL)}` });
  assert.equal(first.statusCode, 200);
  assert.equal(first.headers["content-length"], String(payload.byteLength));
  assert.equal(first.rawPayload.length, payload.byteLength);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.stored.length, 1, "完整请求应触发缓存写入");
  assert.equal(state.stored[0].url, AUDIO_URL);

  const cached = await app.inject({
    method: "GET",
    url: `/api/friend/media?u=${encodeURIComponent(AUDIO_URL)}`,
    headers: { range: "bytes=1-3" }
  });
  assert.equal(cached.statusCode, 206);
  assert.equal(cached.headers["content-range"], `bytes 1-3/${payload.byteLength}`);
  assert.equal(cached.rawPayload.length, 3);
});

test("GET /api/friend/media 上游失败时返回 502", async (context) => {
  const { app, scratch } = createHarness({ mediaError: new Error("upstream down") });
  context.after(() => Promise.all([app.close(), fs.promises.rm(scratch, { recursive: true, force: true })]));
  const response = await app.inject({ method: "GET", url: `/api/friend/media?u=${encodeURIComponent(AUDIO_URL)}` });
  assert.equal(response.statusCode, 502);
  assert.match(response.body, /节目暂时无法播放/);
});
