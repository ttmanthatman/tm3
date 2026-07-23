/// <reference types="node" />

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import type { FriendProgramDTO } from "../../shared/types.js";
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

function createHarness(options: {
  programs?: FriendProgramDTO[];
  programsError?: Error;
  mediaBody?: Uint8Array;
  mediaStatus?: number;
  mediaError?: Error;
} = {}) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "friend-routes-"));
  const state = {
    lastRange: null as string | null,
    stored: [] as Array<{ url: string; size: number | null }>
  };
  const feedService: FriendFeedService = {
    async getPrograms() {
      if (options.programsError) throw options.programsError;
      return options.programs ?? [sampleProgram()];
    },
    isAllowedMediaUrl: (raw: string) => raw.startsWith("https://txly2.net/ly/audio/") || raw.startsWith("https://txly2.net/images/"),
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
  const app = Fastify();
  registerFriendRoutes(app, {
    requireAuth: async () => undefined,
    requireMediaAuth: async () => undefined,
    feedService
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
