import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Prisma, type Actor, type Message, type PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import sharp from "sharp";
import { z } from "zod";
import type { AdminLoginLogKind, MessageDTO, MusicPlaylistDTO } from "../../shared/types.js";
import { isQualifiedMusicPlay } from "../../shared/musicPlayback.js";
import { canManageMusicAsset, canManageMusicRole, isMusicFileName, isMusicScoreImageName } from "../music.js";
import { canReadMusicScore } from "../musicScoreAccess.js";
import { pushOriginFromHeaders } from "../pushOrigin.js";
import type { MusicService } from "../services/musicService.js";
import { parseLyrics } from "../srt.js";

export type MusicAuthContext = {
  accountId: number;
  actorId: number;
  username: string;
  isAdmin: boolean;
  canPinMessages: boolean;
  sessionId: string;
};

export type AuthedMusicRequest = FastifyRequest & { auth: MusicAuthContext };

type SerializedMessageInput = Message & {
  sender: Actor;
  replyTo?: (Message & { sender: Actor }) | null;
};

type MusicProgressLogInput = {
  kind: AdminLoginLogKind;
  accountId: number;
  sessionId?: string | null;
  trackId?: number | null;
  playbackId?: string | null;
  appVersion?: string | null;
  latestVersion?: string | null;
  isLatestVersion?: boolean | null;
  state?: string | null;
  progressMs?: number | null;
  listenedMs?: number | null;
  durationMs?: number | null;
};

type MusicSocketEmitter = {
  emit(event: string, payload: unknown): unknown;
  to(room: string): { emit(event: string, payload: unknown): unknown };
};

export type MusicRouteDependencies = {
  prisma: PrismaClient;
  io: MusicSocketEmitter;
  musicService: MusicService;
  requireAuth: preHandlerHookHandler;
  requireMediaAuth: preHandlerHookHandler;
  uploadDir: string;
  musicScoreDir: string;
  appVersion: string;
  imageWebpEffort: number;
  canAccessChannel(accountId: number, channelId: number): Promise<boolean>;
  canWriteChannel(accountId: number, channelId: number): Promise<boolean>;
  serializeMessage(message: SerializedMessageInput, viewerAccountId?: number): Promise<MessageDTO>;
  hydrateMessage(id: number, viewerAccountId?: number): Promise<MessageDTO | null>;
  emitMessage(messageId: number): Promise<unknown>;
  sendMessagePush(messageId: number, origin: string): Promise<void>;
  deleteMessages(messages: Array<Pick<Message, "id" | "channelId" | "filePath">>): Promise<unknown>;
  writeActivityLog(input: MusicProgressLogInput): Promise<void>;
  applyFileResponseHeaders(reply: FastifyReply, name: string, forceDownload: boolean): unknown;
  applyFileValidation(request: FastifyRequest, reply: FastifyReply, stat: fs.Stats): boolean;
  isAudioFileName(name?: string | null): boolean;
  displayWebpFileName(name: string): string;
  safeUnlinkMusicScore(fileName: string): void;
};

export function registerMusicRoutes(app: FastifyInstance, deps: MusicRouteDependencies) {
  const {
    prisma,
    io,
    musicService,
    requireAuth,
    requireMediaAuth,
    uploadDir,
    musicScoreDir,
    appVersion,
    imageWebpEffort,
    canAccessChannel,
    canWriteChannel,
    serializeMessage,
    hydrateMessage,
    emitMessage,
    sendMessagePush,
    deleteMessages,
    writeActivityLog,
    applyFileResponseHeaders,
    applyFileValidation,
    isAudioFileName,
    displayWebpFileName,
    safeUnlinkMusicScore
  } = deps;

  app.get("/api/music/tracks", { preHandler: requireAuth }, async (request) => {
    const auth = (request as AuthedMusicRequest).auth;
    const messages = await prisma.message.findMany({
      where: { channel: { kind: "music" }, type: "file", filePath: { not: null }, fileName: { not: null } },
      orderBy: [{ musicOrder: "asc" }, { createdAt: "desc" }, { id: "desc" }],
      include: {
        sender: { select: { accountId: true } },
        musicScorePages: { orderBy: { pageIndex: "asc" } },
        musicLyrics: true,
        _count: { select: { musicPlays: true } }
      }
    });
    const favorites = await prisma.musicFavorite.findMany({ where: { accountId: auth.accountId }, select: { trackId: true } });
    const favoriteTrackIds = new Set(favorites.map((favorite) => favorite.trackId));
    return {
      tracks: messages
        .filter((message) => isMusicFileName(message.fileName))
        .map((message, index) =>
          musicService.serializeTrack(message, index, favoriteTrackIds.has(message.id), canManageMusicAsset(auth, message.sender.accountId))
        )
    };
  });

  app.get("/api/music/playlists", { preHandler: requireAuth }, async (request) => {
    const auth = (request as AuthedMusicRequest).auth;
    const rows = await prisma.musicPlaylist.findMany({
      where: { accountId: auth.accountId },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: { id: true }
    });
    const playlists = await Promise.all(rows.map((row) => musicService.playlistDto(row.id, auth.accountId)));
    return { playlists: playlists.filter((playlist): playlist is MusicPlaylistDTO => !!playlist) };
  });

  app.post("/api/music/playlists", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedMusicRequest).auth;
    const parsed = z.object({ name: z.string().trim().min(1).max(120).optional() }).safeParse(request.body || {});
    if (!parsed.success) return reply.code(400).send({ success: false, message: "歌单名称需为 1-120 个字符" });
    const account = await prisma.account.findUniqueOrThrow({ where: { id: auth.accountId }, select: { displayName: true } });
    const baseName = parsed.data.name || `${account.displayName}的歌单`;
    let name = baseName;
    if (!parsed.data.name) {
      const existing = await prisma.musicPlaylist.findMany({
        where: { accountId: auth.accountId, name: { startsWith: baseName } },
        select: { name: true }
      });
      const names = new Set(existing.map((item) => item.name));
      let suffix = 2;
      while (names.has(name)) name = `${baseName} (${suffix++})`;
    }
    const created = await prisma.musicPlaylist.create({ data: { accountId: auth.accountId, name } });
    return { success: true, playlist: await musicService.playlistDto(created.id, auth.accountId) };
  });

  app.get("/api/music/playlists/:id", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedMusicRequest).auth;
    const playlistId = Number((request.params as { id: string }).id);
    if (!(await musicService.canAccessPlaylist(auth.accountId, playlistId))) {
      return reply.code(404).send({ success: false, message: "歌单不存在或尚未分享给你" });
    }
    return { playlist: await musicService.playlistDto(playlistId, auth.accountId) };
  });

  app.patch("/api/music/playlists/:id", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedMusicRequest).auth;
    const playlistId = Number((request.params as { id: string }).id);
    const body = z.object({ name: z.string().trim().min(1).max(120) }).parse(request.body);
    const playlist = await prisma.musicPlaylist.findUnique({ where: { id: playlistId }, select: { accountId: true } });
    if (!playlist || playlist.accountId !== auth.accountId) return reply.code(404).send({ success: false, message: "只能修改自己的歌单" });
    await prisma.musicPlaylist.update({ where: { id: playlistId }, data: { name: body.name } });
    io.emit("music:playlist-updated", { playlistId });
    return { success: true, playlist: await musicService.playlistDto(playlistId, auth.accountId) };
  });

  app.delete("/api/music/playlists/:id", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedMusicRequest).auth;
    const playlistId = Number((request.params as { id: string }).id);
    const playlist = await prisma.musicPlaylist.findUnique({ where: { id: playlistId }, select: { accountId: true } });
    if (!playlist || playlist.accountId !== auth.accountId) return reply.code(404).send({ success: false, message: "只能删除自己的歌单" });
    await prisma.$transaction([
      prisma.musicPlaybackState.updateMany({
        where: { playlistId },
        data: { sourceKind: "library", playlistId: null }
      }),
      prisma.musicPlaylist.delete({ where: { id: playlistId } })
    ]);
    io.emit("music:playlist-updated", { playlistId, deleted: true });
    return { success: true };
  });

  app.put("/api/music/playlists/:id/tracks", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedMusicRequest).auth;
    const playlistId = Number((request.params as { id: string }).id);
    const body = z.object({ trackIds: z.array(z.number().int().positive()).max(500) }).parse(request.body);
    const trackIds = [...new Set(body.trackIds)];
    if (trackIds.length !== body.trackIds.length) return reply.code(400).send({ success: false, message: "歌单中不能重复添加同一首歌" });
    const playlist = await prisma.musicPlaylist.findUnique({ where: { id: playlistId }, select: { accountId: true } });
    if (!playlist || playlist.accountId !== auth.accountId) return reply.code(404).send({ success: false, message: "只能管理自己的歌单" });
    const tracks = trackIds.length
      ? await prisma.message.findMany({
          where: { id: { in: trackIds }, channel: { kind: "music" }, type: "file" },
          select: { id: true, fileName: true }
        })
      : [];
    if (tracks.length !== trackIds.length || tracks.some((track) => !isMusicFileName(track.fileName))) {
      return reply.code(400).send({ success: false, message: "歌单中包含已经失效的歌曲" });
    }
    await prisma.$transaction(async (transaction) => {
      await transaction.musicPlaylistTrack.deleteMany({ where: { playlistId } });
      if (trackIds.length) {
        await transaction.musicPlaylistTrack.createMany({ data: trackIds.map((trackId, position) => ({ playlistId, trackId, position })) });
      }
      await transaction.musicPlaylist.update({ where: { id: playlistId }, data: { updatedAt: new Date() } });
    });
    io.emit("music:playlist-updated", { playlistId });
    return { success: true, playlist: await musicService.playlistDto(playlistId, auth.accountId) };
  });

  app.post("/api/music/playlists/:id/share", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedMusicRequest).auth;
    const pushOrigin = pushOriginFromHeaders(request.headers);
    const playlistId = Number((request.params as { id: string }).id);
    const body = z
      .object({
        channelId: z.number().int().positive(),
        description: z.string().trim().max(500).optional().default("")
      })
      .parse(request.body);
    const playlist = await prisma.musicPlaylist.findUnique({ where: { id: playlistId }, select: { accountId: true, name: true } });
    if (!playlist || playlist.accountId !== auth.accountId) return reply.code(404).send({ success: false, message: "只能分享自己的歌单" });
    const channel = await prisma.channel.findUnique({ where: { id: body.channelId }, select: { kind: true } });
    if (!channel || (channel.kind !== "standard" && channel.kind !== "direct") || !(await canWriteChannel(auth.accountId, body.channelId))) {
      return reply.code(400).send({ success: false, message: "歌单只能分享到公开、私密聊天频道或私聊" });
    }
    const message = await prisma.$transaction(async (transaction) => {
      const created = await transaction.message.create({
        data: {
          channelId: body.channelId,
          senderActorId: auth.actorId,
          content: body.description || `分享了歌单“${playlist.name}”`,
          type: "music_playlist",
          payload: {
            playlistId,
            nameSnapshot: playlist.name,
            ...(body.description ? { description: body.description } : {})
          }
        }
      });
      await transaction.musicPlaylistShare.create({ data: { playlistId, messageId: created.id } });
      return created;
    });
    await emitMessage(message.id);
    void sendMessagePush(message.id, pushOrigin).catch((error) =>
      request.log.warn({ error, messageId: message.id }, "playlist share push failed")
    );
    return { success: true, message: await hydrateMessage(message.id, auth.accountId) };
  });

  app.get("/api/music/playback-state", { preHandler: requireAuth }, async (request) => {
    const auth = (request as AuthedMusicRequest).auth;
    const state = await prisma.musicPlaybackState.findUnique({ where: { accountId: auth.accountId } });
    return { state: state ? musicService.cleanPlaybackState(state) : null };
  });

  app.put("/api/music/playback-state", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedMusicRequest).auth;
    const body = z
      .object({
        sourceKind: z.enum(["library", "favorites", "playlist"]),
        playlistId: z.number().int().positive().nullable().default(null),
        trackId: z.number().int().positive().nullable().default(null),
        progressMs: z.number().int().min(0).max(24 * 60 * 60 * 1000),
        playbackMode: z.enum(["playlist", "single", "shuffle"]),
        knownUpdatedAt: z.string().datetime().optional()
      })
      .parse(request.body);
    const current = await prisma.musicPlaybackState.findUnique({ where: { accountId: auth.accountId } });
    if (current && body.knownUpdatedAt && current.updatedAt.getTime() > new Date(body.knownUpdatedAt).getTime()) {
      return { success: true, accepted: false, state: musicService.cleanPlaybackState(current) };
    }
    if (body.sourceKind === "playlist") {
      if (!body.playlistId || !(await musicService.canAccessPlaylist(auth.accountId, body.playlistId))) {
        return reply.code(403).send({ success: false, message: "无法保存无权访问的歌单" });
      }
    }
    if (body.trackId) {
      const track = await prisma.message.findFirst({
        where: { id: body.trackId, channel: { kind: "music" }, type: "file" },
        select: { id: true, fileName: true }
      });
      if (!track || !isMusicFileName(track.fileName)) return reply.code(400).send({ success: false, message: "歌曲已经失效" });
      if (body.sourceKind === "playlist") {
        const included = await prisma.musicPlaylistTrack.findUnique({
          where: { playlistId_trackId: { playlistId: body.playlistId!, trackId: body.trackId } }
        });
        if (!included) return reply.code(400).send({ success: false, message: "歌曲不在当前歌单中" });
      }
      if (body.sourceKind === "favorites") {
        const favorited = await prisma.musicFavorite.findUnique({
          where: { trackId_accountId: { trackId: body.trackId, accountId: auth.accountId } }
        });
        if (!favorited) return reply.code(400).send({ success: false, message: "歌曲不在收藏中" });
      }
    }
    const state = await prisma.musicPlaybackState.upsert({
      where: { accountId: auth.accountId },
      create: {
        accountId: auth.accountId,
        sourceKind: body.sourceKind,
        playlistId: body.sourceKind === "playlist" ? body.playlistId : null,
        trackId: body.trackId,
        progressMs: body.progressMs,
        playbackMode: body.playbackMode
      },
      update: {
        sourceKind: body.sourceKind,
        playlistId: body.sourceKind === "playlist" ? body.playlistId : null,
        trackId: body.trackId,
        progressMs: body.progressMs,
        playbackMode: body.playbackMode
      }
    });
    return { success: true, accepted: true, state: musicService.cleanPlaybackState(state) };
  });

  app.put("/api/music/tracks/:id/favorite", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedMusicRequest).auth;
    const trackId = Number((request.params as { id: string }).id);
    const body = z.object({ favorited: z.boolean() }).parse(request.body);
    const track = await prisma.message.findFirst({
      where: { id: trackId, channel: { kind: "music" }, type: "file" },
      select: { id: true, fileName: true }
    });
    if (!track || !isMusicFileName(track.fileName)) return reply.code(404).send({ success: false, message: "歌曲不存在" });
    if (body.favorited) {
      await prisma.musicFavorite.upsert({
        where: { trackId_accountId: { trackId, accountId: auth.accountId } },
        update: {},
        create: { trackId, accountId: auth.accountId }
      });
    } else {
      await prisma.musicFavorite.deleteMany({ where: { trackId, accountId: auth.accountId } });
    }
    io.to(`acct:${auth.accountId}`).emit("music:favorite-updated", { trackId, favorited: body.favorited });
    return { success: true, trackId, favorited: body.favorited };
  });

  app.post("/api/music/tracks/:id/play", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedMusicRequest).auth;
    const trackId = Number((request.params as { id: string }).id);
    const body = z
      .object({
        playbackId: z.string().uuid(),
        durationMs: z.number().int().min(5_000).max(6 * 60 * 60 * 1000),
        listenedMs: z.number().int().positive().max(6 * 60 * 60 * 1000)
      })
      .parse(request.body);
    if (!isQualifiedMusicPlay(body.durationMs, body.listenedMs)) {
      return reply.code(400).send({ success: false, message: "播放达到歌曲的 33% 后才会计入热度" });
    }
    const track = await prisma.message.findFirst({
      where: { id: trackId, channel: { kind: "music" }, type: "file", filePath: { not: null }, fileName: { not: null } },
      select: { id: true, fileName: true }
    });
    if (!track || !isMusicFileName(track.fileName)) return reply.code(404).send({ success: false, message: "歌曲不存在" });

    let created = false;
    try {
      await prisma.musicPlay.create({
        data: {
          trackId,
          accountId: auth.accountId,
          playbackId: body.playbackId,
          durationMs: body.durationMs,
          listenedMs: body.listenedMs
        }
      });
      created = true;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    }
    const heat = await prisma.musicPlay.count({ where: { trackId } });
    if (created) io.emit("music:updated", { action: "heat-updated", trackId, heat });
    return { success: true, counted: created, heat };
  });

  app.post("/api/music/tracks/:id/progress", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedMusicRequest).auth;
    const trackId = Number((request.params as { id: string }).id);
    if (!Number.isInteger(trackId) || trackId <= 0) return reply.code(400).send({ success: false, message: "歌曲参数无效" });
    const body = z
      .object({
        playbackId: z.string().uuid(),
        state: z.enum(["started", "progress", "paused", "changed", "ended", "error"]),
        progressMs: z.number().int().min(0).max(6 * 60 * 60 * 1000),
        listenedMs: z.number().int().min(0).max(6 * 60 * 60 * 1000),
        durationMs: z.number().int().min(1).max(6 * 60 * 60 * 1000),
        appVersion: z.string().max(32).optional()
      })
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ success: false, message: "播放进度参数无效" });
    await writeActivityLog({
      kind: "music_progress",
      accountId: auth.accountId,
      sessionId: auth.sessionId,
      trackId,
      playbackId: body.data.playbackId,
      appVersion: body.data.appVersion || null,
      latestVersion: appVersion,
      isLatestVersion: body.data.appVersion ? body.data.appVersion === appVersion : null,
      state: body.data.state,
      progressMs: Math.min(body.data.progressMs, body.data.durationMs),
      listenedMs: Math.min(body.data.listenedMs, body.data.durationMs),
      durationMs: body.data.durationMs
    });
    return { success: true };
  });

  app.patch("/api/music/tracks/order", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedMusicRequest).auth;
    if (!canManageMusicRole(auth)) return reply.code(403).send({ success: false, message: "需要管理员或户部尚书权限" });
    const body = z.object({ trackIds: z.array(z.number().int().positive()).min(1).max(2000) }).parse(request.body);
    const trackIds = [...new Set(body.trackIds)];
    if (trackIds.length !== body.trackIds.length) return reply.code(400).send({ success: false, message: "歌曲排序中包含重复项目" });
    const tracks = await prisma.message.findMany({
      where: { id: { in: trackIds }, channel: { kind: "music" }, type: "file", filePath: { not: null }, fileName: { not: null } },
      select: { id: true, fileName: true }
    });
    if (tracks.filter((track) => isMusicFileName(track.fileName)).length !== trackIds.length) {
      return reply.code(400).send({ success: false, message: "歌曲排序列表已经过期，请刷新后重试" });
    }
    await prisma.$transaction(trackIds.map((id, musicOrder) => prisma.message.update({ where: { id }, data: { musicOrder } })));
    io.emit("music:updated", { action: "reordered" });
    return { success: true };
  });

  app.put("/api/music/tracks/:id/lyrics", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedMusicRequest).auth;
    const id = Number((request.params as { id: string }).id);
    const track = await prisma.message.findFirst({
      where: { id, channel: { kind: "music" }, type: "file" },
      include: { sender: true }
    });
    if (!track?.fileName || !isMusicFileName(track.fileName)) return reply.code(404).send({ success: false, message: "歌曲不存在" });
    if (!canManageMusicAsset(auth, track.sender.accountId)) return reply.code(403).send({ success: false, message: "只能管理自己上传的音乐" });
    try {
      const file = await request.file({ limits: { files: 1, fileSize: 1024 * 1024, parts: 1 } });
      if (!file || !/\.(srt|lrc)$/i.test(file.filename || "")) {
        return reply.code(400).send({ success: false, message: "歌词只支持 SRT、LRC 和 Enhanced LRC 文件" });
      }
      const buffer = await file.toBuffer();
      if (file.file.truncated || buffer.length > 1024 * 1024) return reply.code(400).send({ success: false, message: "歌词文件不能超过 1MB" });
      const content = buffer.toString("utf8");
      const cues = parseLyrics(content, file.filename);
      if (!cues.length) return reply.code(400).send({ success: false, message: "歌词文件中没有有效的时间轴" });
      const updated = await prisma.$transaction(async (transaction) => {
        await transaction.musicLyrics.upsert({
          where: { trackId: id },
          create: { trackId: id, fileName: path.basename(file.filename).slice(0, 255), content },
          update: { fileName: path.basename(file.filename).slice(0, 255), content }
        });
        return transaction.message.findUniqueOrThrow({
          where: { id },
          include: {
            sender: true,
            musicScorePages: { orderBy: { pageIndex: "asc" } },
            musicLyrics: true,
            _count: { select: { musicPlays: true } }
          }
        });
      });
      io.to(`ch:${track.channelId}`).emit("message:updated", await serializeMessage(updated));
      io.emit("music:updated", { action: "lyrics-updated", trackId: id });
      return { success: true, track: musicService.serializeTrack(updated, 0, undefined, true) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "歌词上传失败";
      request.log.warn({ error, trackId: id }, "music lyrics upload failed");
      return reply.code(400).send({ success: false, message });
    }
  });

  app.delete("/api/music/tracks/:id/lyrics", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedMusicRequest).auth;
    const id = Number((request.params as { id: string }).id);
    const track = await prisma.message.findFirst({
      where: { id, channel: { kind: "music" }, type: "file" },
      include: { sender: true }
    });
    if (!track?.fileName || !isMusicFileName(track.fileName)) return reply.code(404).send({ success: false, message: "歌曲不存在" });
    if (!canManageMusicAsset(auth, track.sender.accountId)) return reply.code(403).send({ success: false, message: "只能管理自己上传的音乐" });
    await prisma.musicLyrics.deleteMany({ where: { trackId: id } });
    const updated = await prisma.message.findUniqueOrThrow({
      where: { id },
      include: {
        sender: true,
        musicScorePages: { orderBy: { pageIndex: "asc" } },
        musicLyrics: true,
        _count: { select: { musicPlays: true } }
      }
    });
    io.to(`ch:${track.channelId}`).emit("message:updated", await serializeMessage(updated));
    io.emit("music:updated", { action: "lyrics-deleted", trackId: id });
    return { success: true, track: musicService.serializeTrack(updated, 0, undefined, true) };
  });

  app.put("/api/music/tracks/:id/score", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedMusicRequest).auth;
    const id = Number((request.params as { id: string }).id);
    const track = await prisma.message.findFirst({
      where: { id, channel: { kind: "music" }, type: "file" },
      include: { sender: true }
    });
    if (!track?.fileName || !isMusicFileName(track.fileName)) return reply.code(404).send({ success: false, message: "歌曲不存在" });
    if (!canManageMusicAsset(auth, track.sender.accountId)) {
      return reply.code(403).send({ success: false, message: "只能管理自己上传的音乐和曲谱" });
    }

    const temporaryPaths: string[] = [];
    const createdPaths: string[] = [];
    const pages: Array<{ pageIndex: number; fileName: string; filePath: string; fileSize: number; width: number; height: number }> = [];
    try {
      const parts = request.files({ limits: { files: 20, fileSize: 20 * 1024 * 1024, parts: 20 } });
      let pageIndex = 0;
      for await (const part of parts) {
        if (!isMusicScoreImageName(part.filename)) {
          part.file.resume();
          throw new Error("歌谱只支持 PNG、JPG、JPEG、WebP、HEIC 和 HEIF 图片");
        }
        const extension = path.extname(part.filename).toLowerCase();
        const temporaryName = `.${crypto.randomUUID()}${extension}.tmp`;
        const temporaryPath = path.join(musicScoreDir, temporaryName);
        temporaryPaths.push(temporaryPath);
        await new Promise<void>((resolve, reject) => {
          const stream = fs.createWriteStream(temporaryPath);
          part.file.pipe(stream);
          part.file.on("error", reject);
          stream.on("finish", resolve);
          stream.on("error", reject);
        });
        if (part.file.truncated) throw new Error("单页歌谱不能超过 20MB");

        const storedName = `${crypto.randomUUID()}.webp`;
        const storedPath = path.join(musicScoreDir, storedName);
        const output = await sharp(temporaryPath, { failOn: "error", limitInputPixels: 40_000_000 })
          .rotate()
          .webp({ quality: 92, effort: imageWebpEffort, smartSubsample: true })
          .toFile(storedPath);
        if (!output.width || !output.height || output.width > 20_000 || output.height > 20_000) {
          if (fs.existsSync(storedPath)) fs.unlinkSync(storedPath);
          throw new Error("歌谱图片内容无效或尺寸过大");
        }
        createdPaths.push(storedPath);
        pages.push({
          pageIndex,
          fileName: displayWebpFileName(part.filename),
          filePath: storedName,
          fileSize: output.size,
          width: output.width,
          height: output.height
        });
        pageIndex += 1;
        fs.unlinkSync(temporaryPath);
        temporaryPaths.splice(temporaryPaths.indexOf(temporaryPath), 1);
      }
      if (!pages.length) return reply.code(400).send({ success: false, message: "请至少选择一页歌谱" });

      const previousPages = await prisma.musicScorePage.findMany({ where: { trackId: id }, select: { filePath: true } });
      const updated = await prisma.$transaction(async (transaction) => {
        await transaction.musicScorePage.deleteMany({ where: { trackId: id } });
        await transaction.musicScorePage.createMany({ data: pages.map((page) => ({ trackId: id, ...page })) });
        return transaction.message.findUniqueOrThrow({
          where: { id },
          include: { musicScorePages: { orderBy: { pageIndex: "asc" } }, musicLyrics: true, _count: { select: { musicPlays: true } } }
        });
      });
      createdPaths.length = 0;
      for (const page of previousPages) safeUnlinkMusicScore(page.filePath);
      io.emit("music:updated", { action: "score-updated", trackId: id });
      return { success: true, track: musicService.serializeTrack(updated, 0, undefined, true) };
    } catch (error) {
      for (const filePath of [...temporaryPaths, ...createdPaths]) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
      const message = error instanceof Error ? error.message : "歌谱上传失败";
      request.log.warn({ error, trackId: id }, "music score upload failed");
      return reply.code(400).send({ success: false, message });
    }
  });

  app.patch("/api/music/tracks/:trackId/score", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedMusicRequest).auth;
    const trackId = Number((request.params as { trackId: string }).trackId);
    const body = z.object({ pageIds: z.array(z.number().int().positive()).max(20) }).parse(request.body);
    const pageIds = [...new Set(body.pageIds)];
    if (pageIds.length !== body.pageIds.length) return reply.code(400).send({ success: false, message: "歌谱排序中包含重复页面" });
    const track = await prisma.message.findFirst({
      where: { id: trackId, channel: { kind: "music" }, type: "file" },
      include: { sender: true }
    });
    if (!track?.fileName || !isMusicFileName(track.fileName)) return reply.code(404).send({ success: false, message: "歌曲不存在" });
    if (!canManageMusicAsset(auth, track.sender.accountId)) {
      return reply.code(403).send({ success: false, message: "只能管理自己上传的音乐和曲谱" });
    }
    const existing = await prisma.musicScorePage.findMany({ where: { trackId }, orderBy: { pageIndex: "asc" }, select: { id: true } });
    if (existing.length !== pageIds.length || existing.some((page) => !pageIds.includes(page.id))) {
      return reply.code(400).send({ success: false, message: "歌谱页面已经变化，请刷新后重试" });
    }
    const updated = await prisma.$transaction(async (transaction) => {
      for (let index = 0; index < pageIds.length; index += 1) {
        await transaction.musicScorePage.update({ where: { id: pageIds[index] }, data: { pageIndex: 1000 + index } });
      }
      for (let index = 0; index < pageIds.length; index += 1) {
        await transaction.musicScorePage.update({ where: { id: pageIds[index] }, data: { pageIndex: index } });
      }
      return transaction.message.findUniqueOrThrow({
        where: { id: trackId },
        include: { musicScorePages: { orderBy: { pageIndex: "asc" } }, musicLyrics: true, _count: { select: { musicPlays: true } } }
      });
    });
    io.emit("music:updated", { action: "score-reordered", trackId });
    return { success: true, track: musicService.serializeTrack(updated, 0, undefined, true) };
  });

  app.delete("/api/music/tracks/:trackId/score/:pageId", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedMusicRequest).auth;
    const { trackId: rawTrackId, pageId: rawPageId } = request.params as { trackId: string; pageId: string };
    const trackId = Number(rawTrackId);
    const pageId = Number(rawPageId);
    const page = await prisma.musicScorePage.findFirst({
      where: { id: pageId, trackId, track: { channel: { kind: "music" }, type: "file" } },
      include: { track: { include: { sender: true } } }
    });
    if (!page || !page.track.fileName || !isMusicFileName(page.track.fileName)) {
      return reply.code(404).send({ success: false, message: "歌谱页面不存在" });
    }
    if (!canManageMusicAsset(auth, page.track.sender.accountId)) {
      return reply.code(403).send({ success: false, message: "只能管理自己上传的音乐和曲谱" });
    }
    const remaining = await prisma.musicScorePage.findMany({
      where: { trackId, id: { not: pageId } },
      orderBy: { pageIndex: "asc" },
      select: { id: true }
    });
    const updated = await prisma.$transaction(async (transaction) => {
      await transaction.musicScorePage.delete({ where: { id: pageId } });
      for (let index = 0; index < remaining.length; index += 1) {
        await transaction.musicScorePage.update({ where: { id: remaining[index].id }, data: { pageIndex: 1000 + index } });
      }
      for (let index = 0; index < remaining.length; index += 1) {
        await transaction.musicScorePage.update({ where: { id: remaining[index].id }, data: { pageIndex: index } });
      }
      return transaction.message.findUniqueOrThrow({
        where: { id: trackId },
        include: { musicScorePages: { orderBy: { pageIndex: "asc" } }, musicLyrics: true, _count: { select: { musicPlays: true } } }
      });
    });
    safeUnlinkMusicScore(page.filePath);
    io.emit("music:updated", { action: "score-page-deleted", trackId, pageId });
    return { success: true, track: musicService.serializeTrack(updated, 0, undefined, true) };
  });

  app.get("/api/music/tracks/:trackId/score/:pageId", { preHandler: requireMediaAuth }, async (request, reply) => {
    const auth = (request as AuthedMusicRequest).auth;
    const { trackId, pageId } = request.params as { trackId: string; pageId: string };
    const page = await prisma.musicScorePage.findFirst({
      where: { id: Number(pageId), trackId: Number(trackId), track: { type: "file" } },
      include: { track: { select: { channelId: true, fileName: true, channel: { select: { kind: true } } } } }
    });
    if (!page || !isAudioFileName(page.track.fileName)) return reply.code(404).send({ success: false, message: "歌谱不存在" });
    const canAccessSourceChannel =
      page.track.channel.kind === "music" || (await canAccessChannel(auth.accountId, page.track.channelId));
    if (!canReadMusicScore(page.track.channel.kind, canAccessSourceChannel)) {
      return reply.code(403).send({ success: false, message: "无权查看歌谱" });
    }
    const filePath = path.join(musicScoreDir, path.basename(page.filePath));
    if (!fs.existsSync(filePath)) return reply.code(404).send({ success: false, message: "歌谱文件不存在" });
    const stat = fs.statSync(filePath);
    applyFileResponseHeaders(reply, page.fileName, false);
    if (applyFileValidation(request, reply, stat)) return reply.code(304).send();
    reply.header("Content-Length", String(stat.size));
    return reply.send(fs.createReadStream(filePath));
  });

  app.get("/api/music/tracks/:id/stream", { preHandler: requireMediaAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const message = await prisma.message.findFirst({ where: { id, channel: { kind: "music" }, type: "file" } });
    if (!message?.filePath || !isMusicFileName(message.fileName)) return reply.code(404).send({ success: false, message: "歌曲不存在" });
    const filePath = path.join(uploadDir, path.basename(message.filePath));
    if (!fs.existsSync(filePath)) return reply.code(404).send({ success: false, message: "歌曲文件不存在" });
    const stat = fs.statSync(filePath);
    const range = request.headers.range;
    reply.header("Accept-Ranges", "bytes");
    applyFileResponseHeaders(reply, message.fileName || message.filePath, false);
    if (applyFileValidation(request, reply, stat)) return reply.code(304).send();
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match) {
        const suffixLength = !match[1] && match[2] ? Number(match[2]) : 0;
        const start = suffixLength > 0 ? Math.max(0, stat.size - suffixLength) : match[1] ? Number(match[1]) : 0;
        const end = suffixLength > 0 ? stat.size - 1 : match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
        if (Number.isFinite(start) && Number.isFinite(end) && start <= end && start < stat.size) {
          reply.code(206);
          reply.header("Content-Range", `bytes ${start}-${end}/${stat.size}`);
          reply.header("Content-Length", String(end - start + 1));
          return reply.send(fs.createReadStream(filePath, { start, end }));
        }
      }
      reply.code(416);
      reply.header("Content-Range", `bytes */${stat.size}`);
      return reply.send();
    }
    reply.header("Content-Length", String(stat.size));
    return reply.send(fs.createReadStream(filePath));
  });

  app.patch("/api/music/tracks/:id", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedMusicRequest).auth;
    const id = Number((request.params as { id: string }).id);
    const body = z.object({ name: z.string().trim().min(1).max(200) }).parse(request.body);
    const message = await prisma.message.findFirst({
      where: { id, channel: { kind: "music" }, type: "file" },
      include: { sender: true }
    });
    if (!message?.fileName || !isMusicFileName(message.fileName)) return reply.code(404).send({ success: false, message: "歌曲不存在" });
    if (!canManageMusicAsset(auth, message.sender.accountId)) return reply.code(403).send({ success: false, message: "只能管理自己上传的音乐" });
    const extension = path.extname(message.fileName).toLowerCase();
    const requested = path.basename(body.name).replace(/\.(mp3|m4a)$/i, "").trim();
    if (!requested) return reply.code(400).send({ success: false, message: "歌曲名称不能为空" });
    const updated = await prisma.message.update({
      where: { id },
      data: { fileName: `${requested}${extension}` },
      include: {
        sender: true,
        musicScorePages: { orderBy: { pageIndex: "asc" } },
        musicLyrics: true,
        _count: { select: { musicPlays: true } }
      }
    });
    io.to(`ch:${message.channelId}`).emit("message:updated", await serializeMessage(updated));
    io.emit("music:updated", { action: "renamed", trackId: id });
    return { success: true, track: musicService.serializeTrack(updated, 0, undefined, true) };
  });

  app.delete("/api/music/tracks/:id", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedMusicRequest).auth;
    const id = Number((request.params as { id: string }).id);
    const message = await prisma.message.findFirst({
      where: { id, channel: { kind: "music" }, type: "file" },
      include: { sender: true }
    });
    if (!message?.filePath || !isMusicFileName(message.fileName)) return reply.code(404).send({ success: false, message: "歌曲不存在" });
    if (!canManageMusicAsset(auth, message.sender.accountId)) return reply.code(403).send({ success: false, message: "只能管理自己上传的音乐" });
    await deleteMessages([message]);
    return { success: true };
  });
}
