import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import type { MessageDTO, MusicPlaylistDTO, MusicTrackDTO } from "../../shared/types.js";
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
  createdAt: Date;
  musicOrder: number;
  sender: { accountId: number };
  musicScorePages: [];
  musicLyrics: null;
  _count: { musicPlays: number };
};

type EmittedEvent = { room?: string; event: string; payload: unknown };

const authByToken: Record<string, MusicAuthContext> = {
  owner: { accountId: 10, actorId: 110, username: "owner", isAdmin: false, canPinMessages: false, sessionId: "owner-session" },
  other: { accountId: 20, actorId: 120, username: "other", isAdmin: false, canPinMessages: false, sessionId: "other-session" },
  admin: { accountId: 30, actorId: 130, username: "admin", isAdmin: true, canPinMessages: false, sessionId: "admin-session" },
  manager: { accountId: 40, actorId: 140, username: "manager", isAdmin: false, canPinMessages: true, sessionId: "manager-session" }
};

function trackDto(track: TrackRow, canManage = false): MusicTrackDTO {
  return {
    id: track.id,
    canManage,
    title: track.fileName.replace(/\.(mp3|m4a)$/i, ""),
    fileName: track.fileName,
    fileSize: track.fileSize,
    createdAt: track.createdAt.toISOString(),
    heat: 0,
    manualOrder: track.musicOrder,
    scorePages: [],
    lyrics: null
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
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        musicOrder: 0,
        sender: { accountId: 10 },
        musicScorePages: [],
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
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        musicOrder: 1,
        sender: { accountId: 20 },
        musicScorePages: [],
        musicLyrics: null,
        _count: { musicPlays: 0 }
      }
    ]
  ]);
  const events: EmittedEvent[] = [];
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
      update: async (args: { where: { id: number }; data: { fileName?: string; musicOrder?: number } }) => {
        const track = tracks.get(args.where.id);
        if (!track) throw new Error("missing test track");
        if (args.data.fileName !== undefined) track.fileName = args.data.fileName;
        if (args.data.musicOrder !== undefined) track.musicOrder = args.data.musicOrder;
        return track;
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
      throw new Error("unexpected transaction in music route test");
    }
  } as unknown as PrismaClient;

  const musicService: MusicService = {
    serializeTrack: (message, _fallbackOrder, _favorited, canManage) => trackDto(message as TrackRow, canManage),
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
    safeUnlinkMusicScore: () => undefined
  };

  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ success: false, message: "invalid request", issues: error.issues });
    return reply.code(500).send({ success: false, message: error instanceof Error ? error.message : "internal server error" });
  });
  registerMusicRoutes(app, deps);
  await app.ready();
  return { app, tracks, events };
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
