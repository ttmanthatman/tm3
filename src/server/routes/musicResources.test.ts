import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import multipart from "@fastify/multipart";
import type { PrismaClient } from "@prisma/client";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import sharp from "sharp";
import { z } from "zod";
import type { MessageDTO, MusicPlaylistDTO, MusicTrackDTO } from "../../shared/types.js";
import { musicTrackInfo, musicTrackTitle } from "../music.js";
import type { MusicService } from "../services/musicService.js";
import type { AuthedMusicRequest, MusicAuthContext } from "./music.js";
import { registerMusicResourceRoutes, parseMusicInfoResponse, type MusicResourcesRouteDependencies } from "./musicResources.js";

type TrackRow = {
  id: number;
  channelId: number;
  type: "file";
  fileName: string;
  filePath: string;
  fileSize: number;
  payload: Record<string, unknown> | null;
  createdAt: Date;
  musicOrder: number;
  sender: { accountId: number };
  channel: { kind: "music" };
};

type LyricRow = {
  id: number;
  trackId: number | null;
  fileName: string;
  content: string;
  uploadedByAccountId: number | null;
  createdAt: Date;
};

type ScoreRow = {
  id: number;
  trackId: number | null;
  title: string;
  uploadedByAccountId: number | null;
  createdAt: Date;
};

type PageRow = { id: number; scoreId: number; pageIndex: number; filePath: string };

type EmittedEvent = { room?: string; event: string; payload: unknown };

const LRC_CONTENT = "[00:01.00]第一句\n[00:03.50]第二句\n";

const authByToken: Record<string, MusicAuthContext> = {
  owner: { accountId: 10, actorId: 110, username: "owner", isAdmin: false, canPinMessages: false, sessionId: "owner-session" },
  other: { accountId: 20, actorId: 120, username: "other", isAdmin: false, canPinMessages: false, sessionId: "other-session" },
  admin: { accountId: 30, actorId: 130, username: "admin", isAdmin: true, canPinMessages: false, sessionId: "admin-session" },
  manager: { accountId: 40, actorId: 140, username: "manager", isAdmin: false, canPinMessages: true, sessionId: "manager-session" }
};

function authHeader(token: keyof typeof authByToken) {
  return { authorization: `Bearer ${token}` };
}

function makeTrack(id: number, fileName: string, ownerAccountId: number, payload: Record<string, unknown> | null = null): TrackRow {
  return {
    id,
    channelId: 7,
    type: "file",
    fileName,
    filePath: `track-${id}.bin`,
    fileSize: 100,
    payload,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    musicOrder: id,
    sender: { accountId: ownerAccountId },
    channel: { kind: "music" }
  };
}

function makeLyric(id: number, trackId: number | null, fileName: string, uploadedByAccountId: number | null): LyricRow {
  return { id, trackId, fileName, content: LRC_CONTENT, uploadedByAccountId, createdAt: new Date("2026-01-03T00:00:00.000Z") };
}

function multipartPayload(parts: Array<{ name: string; value?: string; fileName?: string; contentType?: string; data?: Buffer | string }>) {
  const boundary = "----musicresourcetestboundary";
  const chunks: Buffer[] = [];
  for (const part of parts) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"`;
    if (part.fileName) head += `; filename="${part.fileName}"`;
    head += "\r\n";
    if (part.fileName) head += `Content-Type: ${part.contentType || "application/octet-stream"}\r\n`;
    head += "\r\n";
    chunks.push(Buffer.from(head, "utf8"));
    chunks.push(part.data !== undefined ? (typeof part.data === "string" ? Buffer.from(part.data, "utf8") : part.data) : Buffer.from(part.value ?? "", "utf8"));
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` }
  };
}

type AiBehavior =
  | { kind: "disabled" }
  | { kind: "respond"; response: string }
  | { kind: "throw"; message: string };

async function createRouteApp(options: { ai?: AiBehavior } = {}) {
  const ai: AiBehavior = options.ai || { kind: "respond", response: '{"background":"背景","lyricsText":"歌词"}' };
  const tracks = new Map<number, TrackRow>([
    [1, makeTrack(1, "晨光.MP3", 10)],
    [2, makeTrack(2, "远方.m4a", 20, { background: "已有背景" })],
    [3, makeTrack(3, "晨光.mp3", 10)]
  ]);
  const lyrics = new Map<number, LyricRow>([
    [900, makeLyric(900, 1, "晨光.lrc", 10)],
    [901, makeLyric(901, null, "未绑定.lrc", 10)],
    [902, makeLyric(902, null, "别人的歌词.lrc", 20)]
  ]);
  const scores = new Map<number, ScoreRow>([
    [800, { id: 800, trackId: 1, title: "吉他谱", uploadedByAccountId: 10, createdAt: new Date("2026-01-04T00:00:00.000Z") }],
    [801, { id: 801, trackId: null, title: "未绑定谱", uploadedByAccountId: 10, createdAt: new Date("2026-01-05T00:00:00.000Z") }],
    [802, { id: 802, trackId: null, title: "别人的谱", uploadedByAccountId: 20, createdAt: new Date("2026-01-06T00:00:00.000Z") }]
  ]);
  const pages = new Map<number, PageRow>([
    [8000, { id: 8000, scoreId: 800, pageIndex: 0, filePath: "score-800-p1.webp" }],
    [8001, { id: 8001, scoreId: 801, pageIndex: 0, filePath: "score-801-p1.webp" }],
    [8002, { id: 8002, scoreId: 801, pageIndex: 1, filePath: "score-801-p2.webp" }],
    [8003, { id: 8003, scoreId: 802, pageIndex: 0, filePath: "score-802-p1.webp" }]
  ]);
  const events: EmittedEvent[] = [];
  const unlinkedScoreFiles: string[] = [];
  const aiSuggestions: Array<Record<string, unknown>> = [];
  const accounts = new Map<number, string>([
    [10, "上传者甲"],
    [20, "上传者乙"]
  ]);
  let nextLyricId = 1000;
  let nextScoreId = 1000;
  let nextPageId = 9000;

  const scorePages = (scoreId: number) =>
    [...pages.values()].filter((page) => page.scoreId === scoreId).sort((a, b) => a.pageIndex - b.pageIndex);

  const fakePrisma = {
    message: {
      findFirst: async (args: { where: { id?: number } }) => {
        const id = args.where.id;
        return id === undefined ? null : tracks.get(id) || null;
      },
      findMany: async () => [...tracks.values()],
      findUniqueOrThrow: async (args: { where: { id: number } }) => {
        const track = tracks.get(args.where.id);
        if (!track) throw new Error("missing test track");
        return track;
      },
      update: async (args: { where: { id: number }; data: { payload?: Record<string, unknown> | null } }) => {
        const track = tracks.get(args.where.id);
        if (!track) throw new Error("missing test track");
        if (args.data.payload !== undefined) track.payload = args.data.payload;
        return track;
      }
    },
    musicLyrics: {
      findUnique: async (args: { where: { id?: number; trackId?: number } }) => {
        if (args.where.trackId !== undefined) {
          return [...lyrics.values()].find((lyric) => lyric.trackId === args.where.trackId) || null;
        }
        return args.where.id === undefined ? null : lyrics.get(args.where.id) || null;
      },
      findMany: async (args: { where: { trackId: number | null } }) =>
        [...lyrics.values()].filter((lyric) => lyric.trackId === args.where.trackId),
      create: async (args: { data: { trackId: number | null; fileName: string; content: string; uploadedByAccountId: number } }) => {
        const row: LyricRow = {
          id: nextLyricId++,
          trackId: args.data.trackId,
          fileName: args.data.fileName,
          content: args.data.content,
          uploadedByAccountId: args.data.uploadedByAccountId,
          createdAt: new Date("2026-01-07T00:00:00.000Z")
        };
        lyrics.set(row.id, row);
        return row;
      },
      update: async (args: { where: { id: number }; data: { trackId: number | null } }) => {
        const row = lyrics.get(args.where.id);
        if (!row) throw new Error("missing test lyric");
        row.trackId = args.data.trackId;
        return row;
      },
      delete: async (args: { where: { id: number } }) => {
        const row = lyrics.get(args.where.id);
        if (!row) throw new Error("missing test lyric");
        lyrics.delete(args.where.id);
        return row;
      }
    },
    musicScore: {
      findUnique: async (args: { where: { id: number }; include?: { pages?: unknown } }) => {
        const score = scores.get(args.where.id);
        if (!score) return null;
        return args.include?.pages ? { ...score, pages: scorePages(score.id) } : score;
      },
      findMany: async (args: { where: { trackId: number | null } }) =>
        [...scores.values()]
          .filter((score) => score.trackId === args.where.trackId)
          .map((score) => ({ ...score, pages: scorePages(score.id) })),
      create: async (args: {
        data: {
          trackId: number | null;
          title: string;
          uploadedByAccountId: number;
          pages: { create: Array<{ pageIndex: number; fileName: string; filePath: string; fileSize: number; width: number; height: number }> };
        };
      }) => {
        const row: ScoreRow = {
          id: nextScoreId++,
          trackId: args.data.trackId,
          title: args.data.title,
          uploadedByAccountId: args.data.uploadedByAccountId,
          createdAt: new Date("2026-01-08T00:00:00.000Z")
        };
        scores.set(row.id, row);
        for (const page of args.data.pages.create) {
          pages.set(nextPageId, { id: nextPageId, scoreId: row.id, pageIndex: page.pageIndex, filePath: page.filePath });
          nextPageId += 1;
        }
        return { ...row, pages: scorePages(row.id) };
      },
      update: async (args: { where: { id: number }; data: { trackId: number | null } }) => {
        const row = scores.get(args.where.id);
        if (!row) throw new Error("missing test score");
        row.trackId = args.data.trackId;
        return row;
      },
      delete: async (args: { where: { id: number } }) => {
        const row = scores.get(args.where.id);
        if (!row) throw new Error("missing test score");
        scores.delete(args.where.id);
        for (const page of [...pages.values()]) if (page.scoreId === args.where.id) pages.delete(page.id);
        return row;
      }
    },
    account: {
      findMany: async (args: { where: { id: { in: number[] } } }) =>
        args.where.id.in.filter((id) => accounts.has(id)).map((id) => ({ id, displayName: accounts.get(id)! }))
    },
    messageAiSuggestion: {
      create: async (args: { data: Record<string, unknown> }) => {
        aiSuggestions.push(args.data);
        return { id: aiSuggestions.length, ...args.data };
      }
    }
  } as unknown as PrismaClient;

  const playlist: MusicPlaylistDTO = {
    id: 50,
    name: "私有歌单",
    ownerAccountId: 10,
    ownerName: "owner",
    isOwner: true,
    trackCount: 0,
    tracks: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
  const musicService: MusicService = {
    serializeTrack: (message, _fallbackOrder, _favorited, canManage) => {
      const track = message as unknown as TrackRow;
      const info = musicTrackInfo(track.payload);
      const dto: MusicTrackDTO = {
        id: track.id,
        canManage: !!canManage,
        title: musicTrackTitle(track.fileName),
        uploadedByName: null,
        fileName: track.fileName,
        fileSize: track.fileSize,
        createdAt: track.createdAt.toISOString(),
        heat: 0,
        manualOrder: track.musicOrder,
        scores: [],
        lyrics: null,
        background: info.background,
        lyricsText: info.lyricsText
      };
      return dto;
    },
    playlistDto: async () => playlist,
    canAccessPlaylist: async () => false,
    canManageAccount: async (accountId) => accountId === 30 || accountId === 40,
    cleanPlaybackState: (row) => ({
      sourceKind: row.sourceKind === "playlist" || row.sourceKind === "favorites" ? row.sourceKind : "library",
      playlistId: row.playlistId,
      trackId: row.trackId,
      progressMs: row.progressMs,
      playbackMode: row.playbackMode === "single" || row.playbackMode === "playlist" ? row.playbackMode : "shuffle",
      updatedAt: row.updatedAt.toISOString()
    })
  };

  const requireTestAuth = async (request: FastifyRequest, reply: FastifyReply) => {
    const token = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const auth = authByToken[token];
    if (!auth) return reply.code(401).send({ success: false, message: "认证失败" });
    (request as AuthedMusicRequest).auth = auth;
  };
  const io = {
    emit(event: string, payload: unknown) {
      events.push({ event, payload });
    },
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          events.push({ room, event, payload });
        }
      };
    }
  };
  const scoreDir = fs.mkdtempSync(path.join(os.tmpdir(), "tm3-music-resources-test-"));
  const deps: MusicResourcesRouteDependencies = {
    prisma: fakePrisma,
    io,
    musicService,
    requireAuth: requireTestAuth,
    musicScoreDir: scoreDir,
    imageWebpEffort: 1,
    serializeMessage: async (message) =>
      ({
        id: (message as unknown as TrackRow).id,
        channelId: (message as unknown as TrackRow).channelId,
        type: "file",
        content: "",
        createdAt: (message as unknown as TrackRow).createdAt.toISOString()
      }) as MessageDTO,
    displayWebpFileName: (name) => name.replace(/\.[^.]+$/, ".webp"),
    safeUnlinkMusicScore: (fileName) => {
      unlinkedScoreFiles.push(fileName);
    },
    loadAiSettings: async () => ({
      value: { baseUrl: "https://api.example.test", model: "deepseek-chat", enabled: ai.kind !== "disabled" },
      encryptedApiKey: ai.kind === "disabled" ? "" : "encrypted-key"
    }),
    decryptAiApiKey: (value) => (value ? "real-key" : ""),
    callLlm: async () => {
      if (ai.kind === "throw") throw new Error(ai.message);
      if (ai.kind === "disabled") throw new Error("AI 未启用或未配置 API Key");
      return ai.response;
    }
  };

  const app = Fastify();
  await app.register(multipart);
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ success: false, message: "invalid request", issues: error.issues });
    return reply.code(500).send({ success: false, message: error instanceof Error ? error.message : "internal server error" });
  });
  registerMusicResourceRoutes(app, deps);
  await app.ready();
  return { app, tracks, lyrics, scores, pages, events, unlinkedScoreFiles, aiSuggestions, scoreDir };
}

function emitted(events: EmittedEvent[], event: string, payload: unknown) {
  const expected = JSON.stringify(payload);
  return events.some((item) => item.event === event && JSON.stringify(item.payload) === expected);
}

test("music resource routes reject unauthenticated access", async (context) => {
  const { app } = await createRouteApp();
  context.after(() => app.close());

  const response = await app.inject({ method: "GET", url: "/api/music/resources" });

  assert.equal(response.statusCode, 401);
});

test("lyrics upload auto-binds on unique file-name match", async (context) => {
  const { app, lyrics, events } = await createRouteApp();
  context.after(() => app.close());
  const body = multipartPayload([{ name: "file", fileName: "远方.lrc", data: LRC_CONTENT }]);

  const response = await app.inject({ method: "POST", url: "/api/music/resources/lyrics", headers: { ...authHeader("other"), ...body.headers }, payload: body.payload });

  assert.equal(response.statusCode, 200);
  const json = response.json();
  assert.equal(json.success, true);
  assert.equal(json.boundTrackId, 2);
  assert.equal(json.autoBound, true);
  assert.equal(json.lyric.fileName, "远方.lrc");
  assert.equal(json.lyric.cueCount, 2);
  assert.equal(json.lyric.uploadedByAccountId, 20);
  assert.equal(json.lyric.uploadedByName, "上传者乙");
  const created = lyrics.get(json.lyric.id);
  assert.equal(created?.trackId, 2);
  assert.ok(emitted(events, "music:updated", { action: "lyrics-added", trackId: 2, lyricId: json.lyric.id }));
});

test("lyrics upload with multiple name matches stays unbound and returns candidates", async (context) => {
  const { app, lyrics } = await createRouteApp();
  context.after(() => app.close());
  const body = multipartPayload([{ name: "file", fileName: "晨光.lrc", data: LRC_CONTENT }]);

  const response = await app.inject({ method: "POST", url: "/api/music/resources/lyrics", headers: { ...authHeader("owner"), ...body.headers }, payload: body.payload });

  assert.equal(response.statusCode, 200);
  const json = response.json();
  assert.equal(json.boundTrackId, null);
  assert.equal(json.autoBound, false);
  assert.deepEqual(json.candidateTrackIds, [1, 3]);
  assert.equal(lyrics.get(json.lyric.id)?.trackId, null);
});

test("lyrics upload without any name match stays unbound", async (context) => {
  const app_state = await createRouteApp();
  context.after(() => app_state.app.close());
  const body = multipartPayload([{ name: "file", fileName: "不存在的歌.lrc", data: LRC_CONTENT }]);

  const response = await app_state.app.inject({ method: "POST", url: "/api/music/resources/lyrics", headers: { ...authHeader("owner"), ...body.headers }, payload: body.payload });

  assert.equal(response.statusCode, 200);
  const json = response.json();
  assert.equal(json.boundTrackId, null);
  assert.equal(json.autoBound, false);
  assert.equal(json.candidateTrackIds, undefined);
});

test("lyrics upload with explicit trackId validates permission and conflicts", async (context) => {
  const { app } = await createRouteApp();
  context.after(() => app.close());

  const forbiddenBody = multipartPayload([
    { name: "trackId", value: "2" },
    { name: "file", fileName: "随便.lrc", data: LRC_CONTENT }
  ]);
  const forbidden = await app.inject({
    method: "POST",
    url: "/api/music/resources/lyrics",
    headers: { ...authHeader("owner"), ...forbiddenBody.headers },
    payload: forbiddenBody.payload
  });
  assert.equal(forbidden.statusCode, 403);

  const conflictBody = multipartPayload([
    { name: "trackId", value: "1" },
    { name: "file", fileName: "随便.lrc", data: LRC_CONTENT }
  ]);
  const conflict = await app.inject({
    method: "POST",
    url: "/api/music/resources/lyrics",
    headers: { ...authHeader("owner"), ...conflictBody.headers },
    payload: conflictBody.payload
  });
  assert.equal(conflict.statusCode, 409);
  assert.match(conflict.json().message, /已有歌词/);
});

test("lyrics upload rejects invalid files", async (context) => {
  const { app } = await createRouteApp();
  context.after(() => app.close());

  const wrongType = multipartPayload([{ name: "file", fileName: "歌词.txt", data: LRC_CONTENT }]);
  const wrongTypeResponse = await app.inject({
    method: "POST",
    url: "/api/music/resources/lyrics",
    headers: { ...authHeader("owner"), ...wrongType.headers },
    payload: wrongType.payload
  });
  assert.equal(wrongTypeResponse.statusCode, 400);

  const noCues = multipartPayload([{ name: "file", fileName: "空.lrc", data: "没有时间轴\n" }]);
  const noCuesResponse = await app.inject({
    method: "POST",
    url: "/api/music/resources/lyrics",
    headers: { ...authHeader("owner"), ...noCues.headers },
    payload: noCues.payload
  });
  assert.equal(noCuesResponse.statusCode, 400);
  assert.match(noCuesResponse.json().message, /时间轴/);
});

test("score upload auto-binds on unique match and stores converted pages", async (context) => {
  const { app, scores, pages, scoreDir } = await createRouteApp();
  context.after(() => app.close());
  context.after(() => fs.rmSync(scoreDir, { recursive: true, force: true }));
  const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
  const body = multipartPayload([{ name: "file", fileName: "远方.png", contentType: "image/png", data: png }]);

  const response = await app.inject({ method: "POST", url: "/api/music/resources/scores", headers: { ...authHeader("owner"), ...body.headers }, payload: body.payload });

  assert.equal(response.statusCode, 200);
  const json = response.json();
  assert.equal(json.boundTrackId, 2);
  assert.equal(json.autoBound, true);
  assert.equal(json.score.title, "远方");
  assert.equal(json.score.pageCount, 1);
  assert.ok(json.track);
  const created = scores.get(json.score.id);
  assert.equal(created?.trackId, 2);
  const storedPages = [...pages.values()].filter((page) => page.scoreId === json.score.id);
  assert.equal(storedPages.length, 1);
  assert.ok(fs.existsSync(path.join(scoreDir, storedPages[0].filePath)));
});

test("score upload with multiple matches stays unbound with candidates", async (context) => {
  const { app, scores, scoreDir } = await createRouteApp();
  context.after(() => app.close());
  context.after(() => fs.rmSync(scoreDir, { recursive: true, force: true }));
  const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer();
  const body = multipartPayload([{ name: "file", fileName: "晨光.png", contentType: "image/png", data: png }]);

  const response = await app.inject({ method: "POST", url: "/api/music/resources/scores", headers: { ...authHeader("owner"), ...body.headers }, payload: body.payload });

  assert.equal(response.statusCode, 200);
  const json = response.json();
  assert.equal(json.boundTrackId, null);
  assert.equal(json.autoBound, false);
  assert.deepEqual(json.candidateTrackIds, [1, 3]);
  assert.equal(scores.get(json.score.id)?.trackId, null);
});

test("GET resources lists unbound lyrics and scores for any signed-in user", async (context) => {
  const { app } = await createRouteApp();
  context.after(() => app.close());

  const response = await app.inject({ method: "GET", url: "/api/music/resources", headers: authHeader("other") });

  assert.equal(response.statusCode, 200);
  const json = response.json();
  assert.deepEqual(
    json.lyrics.map((item: { id: number }) => item.id).sort(),
    [901, 902]
  );
  assert.deepEqual(
    json.scores.map((item: { id: number }) => item.id).sort(),
    [801, 802]
  );
  const score = json.scores.find((item: { id: number }) => item.id === 801);
  assert.equal(score.pageCount, 2);
  assert.equal(score.previewPageId, 8001);
  assert.equal(score.uploadedByName, "上传者甲");
});

test("lyrics bind enforces target manage permission and uniqueness", async (context) => {
  const { app, lyrics, events } = await createRouteApp();
  context.after(() => app.close());

  const denied = await app.inject({
    method: "POST",
    url: "/api/music/lyrics/901/bind",
    headers: { ...authHeader("owner"), "content-type": "application/json" },
    payload: JSON.stringify({ trackId: 2 })
  });
  assert.equal(denied.statusCode, 403);

  const conflict = await app.inject({
    method: "POST",
    url: "/api/music/lyrics/901/bind",
    headers: { ...authHeader("owner"), "content-type": "application/json" },
    payload: JSON.stringify({ trackId: 1 })
  });
  assert.equal(conflict.statusCode, 409);

  const bound = await app.inject({
    method: "POST",
    url: "/api/music/lyrics/901/bind",
    headers: { ...authHeader("manager"), "content-type": "application/json" },
    payload: JSON.stringify({ trackId: 2 })
  });
  assert.equal(bound.statusCode, 200);
  assert.equal(lyrics.get(901)?.trackId, 2);
  assert.ok(emitted(events, "music:updated", { action: "lyrics-bound", trackId: 2, lyricId: 901 }));
});

test("lyrics bind by stranger on an unbound resource is rejected", async (context) => {
  const { app } = await createRouteApp();
  context.after(() => app.close());

  const denied = await app.inject({
    method: "POST",
    url: "/api/music/lyrics/902/bind",
    headers: { ...authHeader("owner"), "content-type": "application/json" },
    payload: JSON.stringify({ trackId: 1 })
  });
  assert.equal(denied.statusCode, 403);
});

test("lyrics unbind enforces permission on the bound track", async (context) => {
  const { app, lyrics, events } = await createRouteApp();
  context.after(() => app.close());

  const denied = await app.inject({ method: "POST", url: "/api/music/lyrics/900/unbind", headers: authHeader("other") });
  assert.equal(denied.statusCode, 403);

  const response = await app.inject({ method: "POST", url: "/api/music/lyrics/900/unbind", headers: authHeader("owner") });
  assert.equal(response.statusCode, 200);
  assert.equal(lyrics.get(900)?.trackId, null);
  assert.equal(response.json().lyric.id, 900);
  assert.ok(emitted(events, "music:updated", { action: "lyrics-unbound", trackId: 1, lyricId: 900 }));
});

test("score bind and unbind follow the same permission rules", async (context) => {
  const { app, scores, events } = await createRouteApp();
  context.after(() => app.close());

  const denied = await app.inject({
    method: "POST",
    url: "/api/music/scores/801/bind",
    headers: { ...authHeader("owner"), "content-type": "application/json" },
    payload: JSON.stringify({ trackId: 2 })
  });
  assert.equal(denied.statusCode, 403);

  const bound = await app.inject({
    method: "POST",
    url: "/api/music/scores/801/bind",
    headers: { ...authHeader("manager"), "content-type": "application/json" },
    payload: JSON.stringify({ trackId: 2 })
  });
  assert.equal(bound.statusCode, 200);
  assert.equal(scores.get(801)?.trackId, 2);
  assert.ok(emitted(events, "music:updated", { action: "score-bound", trackId: 2, scoreId: 801 }));

  const unbindDenied = await app.inject({ method: "POST", url: "/api/music/scores/801/unbind", headers: authHeader("owner") });
  assert.equal(unbindDenied.statusCode, 403);

  const unbound = await app.inject({ method: "POST", url: "/api/music/scores/801/unbind", headers: authHeader("manager") });
  assert.equal(unbound.statusCode, 200);
  assert.equal(scores.get(801)?.trackId, null);
  assert.equal(unbound.json().score.id, 801);
  assert.ok(emitted(events, "music:updated", { action: "score-unbound", trackId: 2, scoreId: 801 }));
});

test("deleting unbound lyrics is limited to uploader or managers and refuses bound rows", async (context) => {
  const { app, lyrics, events } = await createRouteApp();
  context.after(() => app.close());

  const denied = await app.inject({ method: "DELETE", url: "/api/music/resources/lyrics/901", headers: authHeader("other") });
  assert.equal(denied.statusCode, 403);

  const boundRefused = await app.inject({ method: "DELETE", url: "/api/music/resources/lyrics/900", headers: authHeader("owner") });
  assert.equal(boundRefused.statusCode, 400);
  assert.match(boundRefused.json().message, /已绑定/);

  const response = await app.inject({ method: "DELETE", url: "/api/music/resources/lyrics/901", headers: authHeader("owner") });
  assert.equal(response.statusCode, 200);
  assert.equal(lyrics.has(901), false);
  assert.ok(emitted(events, "music:updated", { action: "lyrics-deleted", lyricId: 901 }));
});

test("deleting an unbound score removes its files and refuses bound scores", async (context) => {
  const { app, scores, unlinkedScoreFiles, events } = await createRouteApp();
  context.after(() => app.close());

  const boundRefused = await app.inject({ method: "DELETE", url: "/api/music/resources/scores/800", headers: authHeader("manager") });
  assert.equal(boundRefused.statusCode, 400);

  const denied = await app.inject({ method: "DELETE", url: "/api/music/resources/scores/801", headers: authHeader("other") });
  assert.equal(denied.statusCode, 403);

  const response = await app.inject({ method: "DELETE", url: "/api/music/resources/scores/801", headers: authHeader("owner") });
  assert.equal(response.statusCode, 200);
  assert.equal(scores.has(801), false);
  assert.deepEqual(unlinkedScoreFiles.sort(), ["score-801-p1.webp", "score-801-p2.webp"]);
  assert.ok(emitted(events, "music:updated", { action: "score-deleted", scoreId: 801 }));
});

test("ai-info reports friendly error when AI is not configured", async (context) => {
  const { app, aiSuggestions } = await createRouteApp({ ai: { kind: "disabled" } });
  context.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/music/tracks/1/ai-info",
    headers: { ...authHeader("owner"), "content-type": "application/json" },
    payload: JSON.stringify({})
  });

  assert.equal(response.statusCode, 503);
  assert.match(response.json().message, /AI/);
  assert.equal(aiSuggestions.length, 0);
});

test("ai-info writes generated info, records a suggestion and broadcasts", async (context) => {
  const { app, tracks, aiSuggestions, events } = await createRouteApp({
    ai: { kind: "respond", response: '```json\n{"background":"这首诗写于远方。","lyricsText":"第一段\\n第二段"}\n```' }
  });
  context.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/music/tracks/1/ai-info",
    headers: { ...authHeader("owner"), "content-type": "application/json" },
    payload: JSON.stringify({})
  });

  assert.equal(response.statusCode, 200);
  const json = response.json();
  assert.equal(json.track.background, "这首诗写于远方。");
  assert.equal(json.track.lyricsText, "第一段\n第二段");
  assert.equal(tracks.get(1)?.payload?.background, "这首诗写于远方。");
  assert.equal(aiSuggestions.length, 1);
  assert.equal(aiSuggestions[0].kind, "music_info");
  assert.equal(aiSuggestions[0].messageId, 1);
  assert.equal(aiSuggestions[0].createdByAccountId, 10);
  assert.equal(aiSuggestions[0].model, "deepseek-chat");
  assert.ok(emitted(events, "music:updated", { action: "info-updated", trackId: 1 }));
});

test("ai-info refuses to overwrite existing info unless overwrite is set", async (context) => {
  const { app, tracks } = await createRouteApp({ ai: { kind: "respond", response: '{"background":"新背景","lyricsText":"新歌词"}' } });
  context.after(() => app.close());

  const conflict = await app.inject({
    method: "POST",
    url: "/api/music/tracks/2/ai-info",
    headers: { ...authHeader("other"), "content-type": "application/json" },
    payload: JSON.stringify({})
  });
  assert.equal(conflict.statusCode, 409);

  const overwritten = await app.inject({
    method: "POST",
    url: "/api/music/tracks/2/ai-info",
    headers: { ...authHeader("other"), "content-type": "application/json" },
    payload: JSON.stringify({ overwrite: true })
  });
  assert.equal(overwritten.statusCode, 200);
  assert.equal(tracks.get(2)?.payload?.background, "新背景");
});

test("ai-info rejects callers without manage permission and unparseable AI output", async (context) => {
  const { app } = await createRouteApp();
  context.after(() => app.close());

  const denied = await app.inject({
    method: "POST",
    url: "/api/music/tracks/1/ai-info",
    headers: { ...authHeader("other"), "content-type": "application/json" },
    payload: JSON.stringify({})
  });
  assert.equal(denied.statusCode, 403);

  const { app: brokenApp } = await createRouteApp({ ai: { kind: "respond", response: "完全不是 JSON" } });
  context.after(() => brokenApp.close());
  const unparseable = await brokenApp.inject({
    method: "POST",
    url: "/api/music/tracks/1/ai-info",
    headers: { ...authHeader("owner"), "content-type": "application/json" },
    payload: JSON.stringify({})
  });
  assert.equal(unparseable.statusCode, 502);
});

test("parseMusicInfoResponse tolerates fences and rejects empty payloads", () => {
  assert.deepEqual(parseMusicInfoResponse('```json\n{"background":"a","lyricsText":"b"}\n```'), { background: "a", lyricsText: "b" });
  assert.deepEqual(parseMusicInfoResponse("前言 {\"background\":\"a\",\"lyricsText\":\"\"} 后记"), { background: "a", lyricsText: "" });
  assert.equal(parseMusicInfoResponse("no json at all"), null);
  assert.equal(parseMusicInfoResponse('{"background":"","lyricsText":""}'), null);
});
