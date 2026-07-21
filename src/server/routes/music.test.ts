import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import type { MessageDTO, MusicPlaylistDTO, MusicTrackDTO } from "../../shared/types.js";
import { musicTrackInfo } from "../music.js";
import type { MusicService } from "../services/musicService.js";
import {
  registerMusicRoutes,
  type AuthedMusicRequest,
  type MusicAuthContext,
  type MusicRouteDependencies
} from "./music.js";

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
  musicScores: [];
  musicLyrics: null;
  _count: { musicPlays: number };
};

type ScoreRow = {
  id: number;
  trackId: number | null;
  title: string;
  uploadedByAccountId: number | null;
};

type PageRow = {
  id: number;
  scoreId: number;
  pageIndex: number;
  fileName: string;
  filePath: string;
  fileSize: number;
  width: number;
  height: number;
};

type EmittedEvent = { room?: string; event: string; payload: unknown };

const authByToken: Record<string, MusicAuthContext> = {
  owner: { accountId: 10, actorId: 110, username: "owner", isAdmin: false, canPinMessages: false, sessionId: "owner-session" },
  other: { accountId: 20, actorId: 120, username: "other", isAdmin: false, canPinMessages: false, sessionId: "other-session" },
  admin: { accountId: 30, actorId: 130, username: "admin", isAdmin: true, canPinMessages: false, sessionId: "admin-session" },
  manager: { accountId: 40, actorId: 140, username: "manager", isAdmin: false, canPinMessages: true, sessionId: "manager-session" }
};

function trackDto(track: TrackRow, canManage = false): MusicTrackDTO {
  const info = musicTrackInfo(track.payload);
  return {
    id: track.id,
    canManage,
    title: track.fileName.replace(/\.(mp3|m4a)$/i, ""),
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
}

async function createRouteApp() {
  const tracks = new Map<number, TrackRow>([
    [
      1,
      {
        id: 1,
        channelId: 7,
        type: "file",
        fileName: "晨光.MP3",
        filePath: "track-1.mp3",
        fileSize: 123,
        payload: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        musicOrder: 0,
        sender: { accountId: 10 },
        channel: { kind: "music" },
        musicScores: [],
        musicLyrics: null,
        _count: { musicPlays: 0 }
      }
    ],
    [
      2,
      {
        id: 2,
        channelId: 7,
        type: "file",
        fileName: "远方.m4a",
        filePath: "track-2.m4a",
        fileSize: 456,
        payload: null,
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        musicOrder: 1,
        sender: { accountId: 20 },
        channel: { kind: "music" },
        musicScores: [],
        musicLyrics: null,
        _count: { musicPlays: 0 }
      }
    ]
  ]);
  const scores = new Map<number, ScoreRow>([
    [500, { id: 500, trackId: 1, title: "吉他谱", uploadedByAccountId: 10 }],
    [501, { id: 501, trackId: null, title: "未绑定谱", uploadedByAccountId: 10 }],
    [502, { id: 502, trackId: null, title: "别人的谱", uploadedByAccountId: 20 }]
  ]);
  const pages = new Map<number, PageRow>([
    [5000, { id: 5000, scoreId: 500, pageIndex: 0, fileName: "p1.png", filePath: "score-p1.webp", fileSize: 100, width: 800, height: 600 }],
    [5001, { id: 5001, scoreId: 500, pageIndex: 1, fileName: "p2.png", filePath: "score-p2.webp", fileSize: 100, width: 800, height: 600 }],
    [5002, { id: 5002, scoreId: 501, pageIndex: 0, fileName: "q1.png", filePath: "score-q1.webp", fileSize: 100, width: 800, height: 600 }]
  ]);
  const events: EmittedEvent[] = [];
  const unlinkedScoreFiles: string[] = [];
  const playlist: MusicPlaylistDTO = {
    id: 50,
    name: "私有歌单",
    ownerAccountId: 10,
    ownerName: "owner",
    isOwner: true,
    trackCount: 1,
    tracks: [trackDto(tracks.get(1)!)],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };

  const scorePages = (scoreId: number) =>
    [...pages.values()].filter((page) => page.scoreId === scoreId).sort((a, b) => a.pageIndex - b.pageIndex);
  const scoreWithTrack = (score: ScoreRow) => ({ ...score, track: score.trackId ? tracks.get(score.trackId) || null : null });

  const fakePrisma = {
    message: {
      findFirst: async (args: { where: { id?: number | { in: number[] } } }) => {
        const id = typeof args.where.id === "number" ? args.where.id : undefined;
        return id === undefined ? null : tracks.get(id) || null;
      },
      findMany: async (args: { where: { id?: { in: number[] } } }) => {
        const ids = args.where.id?.in || [...tracks.keys()];
        return ids.map((id) => tracks.get(id)).filter((track): track is TrackRow => !!track);
      },
      findUniqueOrThrow: async (args: { where: { id: number } }) => {
        const track = tracks.get(args.where.id);
        if (!track) throw new Error("missing test track");
        return track;
      },
      update: async (args: { where: { id: number }; data: { fileName?: string; musicOrder?: number; payload?: Record<string, unknown> | null } }) => {
        const track = tracks.get(args.where.id);
        if (!track) throw new Error("missing test track");
        if (args.data.fileName !== undefined) track.fileName = args.data.fileName;
        if (args.data.musicOrder !== undefined) track.musicOrder = args.data.musicOrder;
        if (args.data.payload !== undefined) track.payload = args.data.payload;
        return track;
      }
    },
    musicScore: {
      findUnique: async (args: { where: { id: number }; include?: { pages?: unknown } }) => {
        const score = scores.get(args.where.id);
        if (!score) return null;
        const withTrack = scoreWithTrack(score);
        return args.include?.pages ? { ...withTrack, pages: scorePages(score.id) } : withTrack;
      },
      update: async (args: { where: { id: number }; data: { title?: string } }) => {
        const score = scores.get(args.where.id);
        if (!score) throw new Error("missing test score");
        if (args.data.title !== undefined) score.title = args.data.title;
        return { ...score, pages: scorePages(score.id) };
      },
      delete: async (args: { where: { id: number } }) => {
        const score = scores.get(args.where.id);
        if (!score) throw new Error("missing test score");
        scores.delete(args.where.id);
        for (const page of [...pages.values()]) if (page.scoreId === args.where.id) pages.delete(page.id);
        return score;
      }
    },
    musicScorePage: {
      findMany: async (args: { where: { scoreId?: number; id?: { not: number } } }) => {
        let rows = [...pages.values()];
        if (args.where.scoreId !== undefined) rows = rows.filter((page) => page.scoreId === args.where.scoreId);
        if (args.where.id?.not !== undefined) rows = rows.filter((page) => page.id !== args.where.id!.not);
        return rows.sort((a, b) => a.pageIndex - b.pageIndex);
      },
      findFirst: async (args: { where: { id?: number; scoreId?: number } }) => {
        const page = args.where.id === undefined ? undefined : pages.get(args.where.id);
        if (!page || (args.where.scoreId !== undefined && page.scoreId !== args.where.scoreId)) return null;
        return { ...page, score: scoreWithTrack(scores.get(page.scoreId)!) };
      },
      update: async (args: { where: { id: number }; data: { pageIndex?: number } }) => {
        const page = pages.get(args.where.id);
        if (!page) throw new Error("missing test page");
        if (args.data.pageIndex !== undefined) page.pageIndex = args.data.pageIndex;
        return page;
      },
      delete: async (args: { where: { id: number } }) => {
        const page = pages.get(args.where.id);
        if (!page) throw new Error("missing test page");
        pages.delete(args.where.id);
        return page;
      }
    },
    musicFavorite: {
      findMany: async () => []
    },
    musicPlaylist: {
      findUnique: async (args: { where: { id: number } }) => (args.where.id === 50 ? { accountId: 10, name: playlist.name } : null),
      update: async (_args: unknown) => ({})
    },
    $transaction: async (input: unknown) => {
      if (Array.isArray(input)) return Promise.all(input);
      if (typeof input === "function") return input(fakePrisma);
      throw new Error("unexpected transaction in music route test");
    }
  } as unknown as PrismaClient;

  const musicService: MusicService = {
    serializeTrack: (message, _fallbackOrder, _favorited, canManage) => trackDto(message as unknown as TrackRow, canManage),
    playlistDto: async (_playlistId, viewerAccountId) => ({ ...playlist, isOwner: viewerAccountId === playlist.ownerAccountId }),
    canAccessPlaylist: async (accountId, playlistId) => playlistId === 50 && accountId === playlist.ownerAccountId,
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
  const serializedMessage = (track: TrackRow): MessageDTO =>
    ({
      id: track.id,
      channelId: track.channelId,
      type: "file",
      content: "",
      createdAt: track.createdAt.toISOString()
    }) as MessageDTO;
  const deps: MusicRouteDependencies = {
    prisma: fakePrisma,
    io,
    musicService,
    requireAuth: requireTestAuth,
    requireMediaAuth: requireTestAuth,
    uploadDir: "/tmp",
    musicScoreDir: "/tmp",
    appVersion: "test",
    imageWebpEffort: 1,
    canAccessChannel: async () => false,
    canWriteChannel: async () => false,
    serializeMessage: async (message) => serializedMessage(message as unknown as TrackRow),
    hydrateMessage: async () => null,
    emitMessage: async () => undefined,
    sendMessagePush: async () => undefined,
    deleteMessages: async () => undefined,
    writeActivityLog: async () => undefined,
    applyFileResponseHeaders: () => undefined,
    applyFileValidation: () => false,
    isAudioFileName: () => true,
    displayWebpFileName: (name) => name,
    safeUnlinkMusicScore: (fileName) => {
      unlinkedScoreFiles.push(fileName);
    }
  };

  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ success: false, message: "invalid request", issues: error.issues });
    return reply.code(500).send({ success: false, message: error instanceof Error ? error.message : "internal server error" });
  });
  registerMusicRoutes(app, deps);
  await app.ready();
  return { app, tracks, scores, pages, events, unlinkedScoreFiles };
}

function authHeader(token: keyof typeof authByToken) {
  return { authorization: `Bearer ${token}` };
}

test("music routes reject unauthenticated access", async (context) => {
  const { app } = await createRouteApp();
  context.after(() => app.close());

  const response = await app.inject({ method: "GET", url: "/api/music/tracks" });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { success: false, message: "认证失败" });
});

test("regular accounts manage only their own tracks while music managers can manage all tracks", async (context) => {
  const { app } = await createRouteApp();
  context.after(() => app.close());

  const denied = await app.inject({
    method: "PATCH",
    url: "/api/music/tracks/2",
    headers: authHeader("owner"),
    payload: { name: "越权改名" }
  });
  assert.equal(denied.statusCode, 403);
  assert.deepEqual(denied.json(), { success: false, message: "只能管理自己上传的音乐" });

  for (const token of ["admin", "manager"] as const) {
    const allowed = await app.inject({
      method: "PATCH",
      url: "/api/music/tracks/2",
      headers: authHeader(token),
      payload: { name: `${token}改名` }
    });
    assert.equal(allowed.statusCode, 200);
  }
});

test("track rename sanitizes paths, preserves the original extension, and emits realtime notifications", async (context) => {
  const { app, tracks, events } = await createRouteApp();
  context.after(() => app.close());

  const response = await app.inject({
    method: "PATCH",
    url: "/api/music/tracks/1",
    headers: authHeader("owner"),
    payload: { name: "../新名字.m4a" }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(tracks.get(1)?.fileName, "新名字.mp3");
  assert.equal(response.json().track.fileName, "新名字.mp3");
  assert.ok(events.some((item) => item.room === "ch:7" && item.event === "message:updated"));
  assert.ok(events.some((item) => item.event === "music:updated" && JSON.stringify(item.payload) === '{"action":"renamed","trackId":1}'));
});

test("music routes preserve malformed input and missing-track responses", async (context) => {
  const { app } = await createRouteApp();
  context.after(() => app.close());

  const invalidName = await app.inject({
    method: "PATCH",
    url: "/api/music/tracks/1",
    headers: authHeader("owner"),
    payload: { name: ".mp3" }
  });
  assert.equal(invalidName.statusCode, 400);
  assert.deepEqual(invalidName.json(), { success: false, message: "歌曲名称不能为空" });

  const invalidParameter = await app.inject({
    method: "POST",
    url: "/api/music/tracks/not-a-number/progress",
    headers: authHeader("owner"),
    payload: {}
  });
  assert.equal(invalidParameter.statusCode, 400);
  assert.deepEqual(invalidParameter.json(), { success: false, message: "歌曲参数无效" });

  const missing = await app.inject({
    method: "PATCH",
    url: "/api/music/tracks/999",
    headers: authHeader("owner"),
    payload: { name: "不存在" }
  });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json(), { success: false, message: "歌曲不存在" });
});

test("track ordering requires an administrator or music management role", async (context) => {
  const { app } = await createRouteApp();
  context.after(() => app.close());

  const denied = await app.inject({
    method: "PATCH",
    url: "/api/music/tracks/order",
    headers: authHeader("owner"),
    payload: { trackIds: [1, 2] }
  });
  assert.equal(denied.statusCode, 403);

  const duplicate = await app.inject({
    method: "PATCH",
    url: "/api/music/tracks/order",
    headers: authHeader("manager"),
    payload: { trackIds: [1, 1] }
  });
  assert.equal(duplicate.statusCode, 400);
  assert.deepEqual(duplicate.json(), { success: false, message: "歌曲排序中包含重复项目" });

  const allowed = await app.inject({
    method: "PATCH",
    url: "/api/music/tracks/order",
    headers: authHeader("manager"),
    payload: { trackIds: [2, 1] }
  });
  assert.equal(allowed.statusCode, 200);
  assert.deepEqual(allowed.json(), { success: true });
});

test("personal playlists hide reads and mutations from non-owners", async (context) => {
  const { app } = await createRouteApp();
  context.after(() => app.close());

  const read = await app.inject({ method: "GET", url: "/api/music/playlists/50", headers: authHeader("other") });
  assert.equal(read.statusCode, 404);
  assert.deepEqual(read.json(), { success: false, message: "歌单不存在或尚未分享给你" });

  const update = await app.inject({
    method: "PATCH",
    url: "/api/music/playlists/50",
    headers: authHeader("other"),
    payload: { name: "越权歌单" }
  });
  assert.equal(update.statusCode, 404);
  assert.deepEqual(update.json(), { success: false, message: "只能修改自己的歌单" });
});

test("score rename is limited to the uploader or music managers", async (context) => {
  const { app, scores, events } = await createRouteApp();
  context.after(() => app.close());

  const denied = await app.inject({
    method: "PATCH",
    url: "/api/music/scores/501",
    headers: authHeader("other"),
    payload: { title: "越权谱名" }
  });
  assert.equal(denied.statusCode, 403);
  assert.deepEqual(denied.json(), { success: false, message: "只能管理自己上传的音乐和曲谱" });

  const missing = await app.inject({
    method: "PATCH",
    url: "/api/music/scores/999",
    headers: authHeader("owner"),
    payload: { title: "不存在" }
  });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json(), { success: false, message: "歌谱不存在" });

  const renamed = await app.inject({
    method: "PATCH",
    url: "/api/music/scores/501",
    headers: authHeader("owner"),
    payload: { title: "  钢琴谱  " }
  });
  assert.equal(renamed.statusCode, 200);
  assert.equal(renamed.json().score.title, "钢琴谱");
  assert.equal(scores.get(501)?.title, "钢琴谱");

  const byManager = await app.inject({
    method: "PATCH",
    url: "/api/music/scores/502",
    headers: authHeader("manager"),
    payload: { title: "管理改名" }
  });
  assert.equal(byManager.statusCode, 200);
  assert.ok(events.some((item) => item.event === "music:updated" && JSON.stringify(item.payload) === '{"action":"score-renamed","trackId":null,"scoreId":502}'));
});

test("deleting a score cascades its pages and cleans up files", async (context) => {
  const { app, scores, pages, events, unlinkedScoreFiles } = await createRouteApp();
  context.after(() => app.close());

  const denied = await app.inject({ method: "DELETE", url: "/api/music/scores/500", headers: authHeader("other") });
  assert.equal(denied.statusCode, 403);
  assert.deepEqual(denied.json(), { success: false, message: "只能管理自己上传的音乐和曲谱" });

  const response = await app.inject({ method: "DELETE", url: "/api/music/scores/500", headers: authHeader("owner") });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().success, true);
  assert.ok(response.json().track, "bound score deletion returns the refreshed track");
  assert.equal(scores.has(500), false);
  assert.deepEqual([...pages.values()].filter((page) => page.scoreId === 500), []);
  assert.deepEqual(unlinkedScoreFiles, ["score-p1.webp", "score-p2.webp"]);
  assert.ok(events.some((item) => item.event === "music:updated" && JSON.stringify(item.payload) === '{"action":"score-deleted","trackId":1,"scoreId":500}'));
});

test("score page reorder rejects duplicates and stale lists, then reindexes", async (context) => {
  const { app, pages } = await createRouteApp();
  context.after(() => app.close());

  const duplicate = await app.inject({
    method: "PATCH",
    url: "/api/music/scores/500/pages",
    headers: authHeader("owner"),
    payload: { pageIds: [5000, 5000] }
  });
  assert.equal(duplicate.statusCode, 400);
  assert.deepEqual(duplicate.json(), { success: false, message: "歌谱排序中包含重复页面" });

  const stale = await app.inject({
    method: "PATCH",
    url: "/api/music/scores/500/pages",
    headers: authHeader("owner"),
    payload: { pageIds: [5000, 9999] }
  });
  assert.equal(stale.statusCode, 400);
  assert.deepEqual(stale.json(), { success: false, message: "歌谱页面已经变化，请刷新后重试" });

  const denied = await app.inject({
    method: "PATCH",
    url: "/api/music/scores/500/pages",
    headers: authHeader("other"),
    payload: { pageIds: [5001, 5000] }
  });
  assert.equal(denied.statusCode, 403);

  const reordered = await app.inject({
    method: "PATCH",
    url: "/api/music/scores/500/pages",
    headers: authHeader("owner"),
    payload: { pageIds: [5001, 5000] }
  });
  assert.equal(reordered.statusCode, 200);
  assert.equal(pages.get(5001)?.pageIndex, 0);
  assert.equal(pages.get(5000)?.pageIndex, 1);
});

test("deleting a score page reindexes the remaining pages and unlinks its file", async (context) => {
  const { app, pages, unlinkedScoreFiles } = await createRouteApp();
  context.after(() => app.close());

  const missing = await app.inject({ method: "DELETE", url: "/api/music/scores/500/pages/9999", headers: authHeader("owner") });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json(), { success: false, message: "歌谱页面不存在" });

  const denied = await app.inject({ method: "DELETE", url: "/api/music/scores/500/pages/5000", headers: authHeader("other") });
  assert.equal(denied.statusCode, 403);

  const response = await app.inject({ method: "DELETE", url: "/api/music/scores/500/pages/5000", headers: authHeader("owner") });
  assert.equal(response.statusCode, 200);
  assert.equal(pages.has(5000), false);
  assert.equal(pages.get(5001)?.pageIndex, 0);
  assert.deepEqual(unlinkedScoreFiles, ["score-p1.webp"]);
});

test("score page file reads keep channel rules and restrict unbound scores", async (context) => {
  const { app } = await createRouteApp();
  context.after(() => app.close());

  const missing = await app.inject({ method: "GET", url: "/api/music/scores/501/pages/9999", headers: authHeader("owner") });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json(), { success: false, message: "歌谱不存在" });

  const unboundDenied = await app.inject({ method: "GET", url: "/api/music/scores/501/pages/5002", headers: authHeader("other") });
  assert.equal(unboundDenied.statusCode, 403);
  assert.deepEqual(unboundDenied.json(), { success: false, message: "无权查看歌谱" });

  // uploader and music managers pass the permission check and only fail on the absent test file
  for (const token of ["owner", "manager"] as const) {
    const allowed = await app.inject({ method: "GET", url: "/api/music/scores/501/pages/5002", headers: authHeader(token) });
    assert.equal(allowed.statusCode, 404);
    assert.deepEqual(allowed.json(), { success: false, message: "歌谱文件不存在" });
  }

  // bound scores stay readable for every authenticated user of the shared music channel
  const bound = await app.inject({ method: "GET", url: "/api/music/scores/500/pages/5000", headers: authHeader("other") });
  assert.equal(bound.statusCode, 404);
  assert.deepEqual(bound.json(), { success: false, message: "歌谱文件不存在" });
});

test("track info validates input, preserves unrelated payload keys, and clears emptied fields", async (context) => {
  const { app, tracks, events } = await createRouteApp();
  context.after(() => app.close());
  tracks.get(1)!.payload = { playlistId: 7 };

  const empty = await app.inject({ method: "PUT", url: "/api/music/tracks/1/info", headers: authHeader("owner"), payload: {} });
  assert.equal(empty.statusCode, 400);
  assert.deepEqual(empty.json(), { success: false, message: "没有需要保存的歌曲资料" });

  const tooLong = await app.inject({
    method: "PUT",
    url: "/api/music/tracks/1/info",
    headers: authHeader("owner"),
    payload: { background: "长".repeat(5001) }
  });
  assert.equal(tooLong.statusCode, 400);

  const denied = await app.inject({
    method: "PUT",
    url: "/api/music/tracks/2/info",
    headers: authHeader("owner"),
    payload: { background: "越权" }
  });
  assert.equal(denied.statusCode, 403);
  assert.deepEqual(denied.json(), { success: false, message: "只能管理自己上传的音乐" });

  const saved = await app.inject({
    method: "PUT",
    url: "/api/music/tracks/1/info",
    headers: authHeader("owner"),
    payload: { background: "写作背景", lyricsText: "知识歌词" }
  });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(tracks.get(1)?.payload, { playlistId: 7, background: "写作背景", lyricsText: "知识歌词" });
  assert.equal(saved.json().track.background, "写作背景");
  assert.equal(saved.json().track.lyricsText, "知识歌词");
  assert.ok(events.some((item) => item.room === "ch:7" && item.event === "message:updated"));
  assert.ok(events.some((item) => item.event === "music:updated" && JSON.stringify(item.payload) === '{"action":"info-updated","trackId":1}'));

  const cleared = await app.inject({
    method: "PUT",
    url: "/api/music/tracks/1/info",
    headers: authHeader("owner"),
    payload: { background: null }
  });
  assert.equal(cleared.statusCode, 200);
  assert.deepEqual(tracks.get(1)?.payload, { playlistId: 7, lyricsText: "知识歌词" });
});
