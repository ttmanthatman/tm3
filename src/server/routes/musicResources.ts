import path from "node:path";
import { Prisma, type Actor, type Message, type PrismaClient } from "@prisma/client";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { MessageDTO, MusicLyricsResourceDTO, MusicScoreResourceDTO, MusicTrackDTO } from "../../shared/types.js";
import { canManageMusicAsset, canManageMusicRole, isMusicFileName, musicTrackInfo, musicTrackTitle } from "../music.js";
import { multipartTextFields, processScoreImageParts } from "../musicScoreUpload.js";
import type { MusicService } from "../services/musicService.js";
import { parseLyrics } from "../srt.js";
import type { AuthedMusicRequest, MusicAuthContext } from "./music.js";

type SerializedMessageInput = Message & {
  sender: Actor;
  replyTo?: (Message & { sender: Actor }) | null;
};

type MusicSocketEmitter = {
  emit(event: string, payload: unknown): unknown;
  to(room: string): { emit(event: string, payload: unknown): unknown };
};

type AiChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type MusicResourcesRouteDependencies = {
  prisma: PrismaClient;
  io: MusicSocketEmitter;
  musicService: MusicService;
  requireAuth: preHandlerHookHandler;
  musicScoreDir: string;
  imageWebpEffort: number;
  serializeMessage(message: SerializedMessageInput, viewerAccountId?: number): Promise<MessageDTO>;
  displayWebpFileName(name: string): string;
  safeUnlinkMusicScore(fileName: string): void;
  loadAiSettings(): Promise<{ value: { baseUrl: string; model: string; enabled: boolean }; encryptedApiKey: string }>;
  decryptAiApiKey(value: string): string;
  callLlm(
    messages: AiChatMessage[],
    options?: { model?: string; temperature?: number; maxTokens?: number; timeoutMs?: number }
  ): Promise<string>;
};

const MUSIC_INFO_SYSTEM_PROMPT = [
  "你是教会诗歌资料助手。根据用户给出的诗歌名称，补全这首诗歌的资料。",
  "严格输出一个 JSON 对象，不要输出任何其他文字或 Markdown 代码块：",
  '{"background": "写作背景，不超过500字；不确定的内容不要编造，可留空字符串", "lyricsText": "完整歌词纯文本，按段落换行，不含时间轴标记；不知道歌词时留空字符串"}'
].join("\n");

export function parseMusicInfoResponse(raw: string): { background: string; lyricsText: string } | null {
  const normalized = String(raw || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  const match = /\{[\s\S]*\}/.exec(normalized);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const background = typeof record.background === "string" ? record.background.trim().slice(0, 5000) : "";
  const lyricsText = typeof record.lyricsText === "string" ? record.lyricsText.trim().slice(0, 20000) : "";
  if (!background && !lyricsText) return null;
  return { background, lyricsText };
}

function fileStem(fileName: string) {
  return path.basename(fileName || "").replace(/\.[^.]+$/, "").trim();
}

export function registerMusicResourceRoutes(app: FastifyInstance, deps: MusicResourcesRouteDependencies) {
  const {
    prisma,
    io,
    musicService,
    requireAuth,
    musicScoreDir,
    imageWebpEffort,
    serializeMessage,
    displayWebpFileName,
    safeUnlinkMusicScore,
    loadAiSettings,
    decryptAiApiKey,
    callLlm
  } = deps;

  const trackScoresInclude = {
    orderBy: { id: "asc" as const },
    include: { pages: { orderBy: { pageIndex: "asc" as const } } }
  };

  const aiInfoRateLimit = new Map<number, number[]>();

  function consumeAiInfoRateLimit(accountId: number) {
    const now = Date.now();
    const stamps = (aiInfoRateLimit.get(accountId) || []).filter((stamp) => now - stamp < 60_000);
    if (stamps.length >= 3) {
      aiInfoRateLimit.set(accountId, stamps);
      return false;
    }
    stamps.push(now);
    aiInfoRateLimit.set(accountId, stamps);
    return true;
  }

  type TrackSummary = {
    id: number;
    channelId: number;
    fileName: string | null;
    sender: { accountId: number | null };
  };

  async function findMusicTrack(trackId: number): Promise<TrackSummary | null> {
    const track = await prisma.message.findFirst({
      where: { id: trackId, channel: { kind: "music" }, type: "file" },
      select: { id: true, channelId: true, fileName: true, sender: { select: { accountId: true } } }
    });
    if (!track || !isMusicFileName(track.fileName)) return null;
    return track;
  }

  async function matchTracksByStem(stem: string): Promise<TrackSummary[]> {
    const target = stem.trim().toLowerCase();
    if (!target) return [];
    const tracks = await prisma.message.findMany({
      where: { channel: { kind: "music" }, type: "file", fileName: { not: null } },
      select: { id: true, channelId: true, fileName: true, sender: { select: { accountId: true } } }
    });
    return tracks.filter((track) => isMusicFileName(track.fileName) && musicTrackTitle(track.fileName).toLowerCase() === target);
  }

  type ResourceRow = { trackId: number | null; uploadedByAccountId: number | null };

  async function canMutateResource(auth: MusicAuthContext, resource: ResourceRow) {
    if (resource.trackId) {
      const current = await findMusicTrack(resource.trackId);
      return current ? canManageMusicAsset(auth, current.sender.accountId) : canManageMusicRole(auth);
    }
    return canManageMusicRole(auth) || resource.uploadedByAccountId === auth.accountId;
  }

  async function loadUploaderNames(accountIds: Array<number | null>) {
    const ids = [...new Set(accountIds.filter((id): id is number => typeof id === "number"))];
    if (!ids.length) return new Map<number, string>();
    const accounts = await prisma.account.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } });
    return new Map(accounts.map((account) => [account.id, account.displayName]));
  }

  function uploaderNameOf(uploadedByAccountId: number | null, uploaderNames: Map<number, string>) {
    return uploadedByAccountId ? uploaderNames.get(uploadedByAccountId) ?? null : null;
  }

  function serializeLyricsResource(
    row: { id: number; fileName: string; content: string; uploadedByAccountId: number | null; createdAt: Date },
    uploaderNames: Map<number, string>
  ): MusicLyricsResourceDTO {
    return {
      id: row.id,
      fileName: row.fileName,
      cueCount: parseLyrics(row.content, row.fileName).length,
      createdAt: row.createdAt.toISOString(),
      uploadedByAccountId: row.uploadedByAccountId,
      uploadedByName: uploaderNameOf(row.uploadedByAccountId, uploaderNames)
    };
  }

  function serializeScoreResource(
    row: { id: number; title: string; uploadedByAccountId: number | null; createdAt: Date; pages: Array<{ id: number; pageIndex: number; fileName: string }> },
    uploaderNames: Map<number, string>
  ): MusicScoreResourceDTO {
    const ordered = [...row.pages].sort((a, b) => a.pageIndex - b.pageIndex);
    const kind = ordered[0]?.fileName?.toLowerCase().endsWith(".pdf") ? "pdf" : "image";
    return {
      id: row.id,
      title: row.title,
      kind,
      pageCount: row.pages.length,
      previewPageId: ordered[0]?.id ?? null,
      createdAt: row.createdAt.toISOString(),
      uploadedByAccountId: row.uploadedByAccountId,
      uploadedByName: uploaderNameOf(row.uploadedByAccountId, uploaderNames)
    };
  }

  async function loadTrackForResponse(trackId: number) {
    return prisma.message.findUniqueOrThrow({
      where: { id: trackId },
      include: {
        sender: true,
        musicScores: trackScoresInclude,
        musicLyrics: true,
        _count: { select: { musicPlays: true } }
      }
    });
  }

  async function emitTrackMessageUpdated(trackId: number) {
    const updated = await loadTrackForResponse(trackId);
    io.to(`ch:${updated.channelId}`).emit("message:updated", await serializeMessage(updated));
  }

  async function emitAndSerializeTrack(trackId: number): Promise<MusicTrackDTO> {
    const updated = await loadTrackForResponse(trackId);
    io.to(`ch:${updated.channelId}`).emit("message:updated", await serializeMessage(updated));
    return musicService.serializeTrack(updated, 0, undefined, true);
  }

  app.post("/api/music/resources/lyrics", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedMusicRequest).auth;
    const file = await request.file({ limits: { files: 1, fileSize: 1024 * 1024, parts: 5 } });
    if (!file || !/\.(srt|lrc)$/i.test(file.filename || "")) {
      return reply.code(400).send({ success: false, message: "歌词只支持 SRT、LRC 和 Enhanced LRC 文件" });
    }
    const buffer = await file.toBuffer();
    if (file.file.truncated || buffer.length > 1024 * 1024) {
      return reply.code(400).send({ success: false, message: "歌词文件不能超过 1MB" });
    }
    const content = buffer.toString("utf8");
    const cues = parseLyrics(content, file.filename);
    if (!cues.length) return reply.code(400).send({ success: false, message: "歌词文件中没有有效的时间轴" });

    const fields = multipartTextFields(file.fields);
    let boundTrackId: number | null = null;
    let autoBound = false;
    let candidateTrackIds: number[] = [];
    let bindConflict: string | null = null;

    if (fields.trackId?.trim()) {
      const requestedTrackId = Number(fields.trackId);
      if (!Number.isInteger(requestedTrackId) || requestedTrackId <= 0) {
        return reply.code(400).send({ success: false, message: "歌曲参数无效" });
      }
      const track = await findMusicTrack(requestedTrackId);
      if (!track) return reply.code(404).send({ success: false, message: "歌曲不存在" });
      if (!canManageMusicAsset(auth, track.sender.accountId)) {
        return reply.code(403).send({ success: false, message: "只能管理自己上传的音乐" });
      }
      const existing = await prisma.musicLyrics.findUnique({ where: { trackId: track.id }, select: { id: true } });
      if (existing) return reply.code(409).send({ success: false, message: "该歌曲已有歌词，请先解绑或删除原有歌词" });
      boundTrackId = track.id;
    } else {
      const matches = await matchTracksByStem(fileStem(file.filename));
      if (matches.length === 1) {
        const existing = await prisma.musicLyrics.findUnique({ where: { trackId: matches[0].id }, select: { id: true } });
        if (existing) bindConflict = "lyrics-exists";
        else {
          boundTrackId = matches[0].id;
          autoBound = true;
        }
      } else if (matches.length > 1) {
        candidateTrackIds = matches.map((match) => match.id);
      }
    }

    const created = await prisma.musicLyrics.create({
      data: {
        trackId: boundTrackId,
        fileName: path.basename(file.filename).slice(0, 255),
        content,
        uploadedByAccountId: auth.accountId
      }
    });
    const uploaderNames = await loadUploaderNames([created.uploadedByAccountId]);
    io.emit("music:updated", { action: "lyrics-added", trackId: boundTrackId, lyricId: created.id });
    if (boundTrackId) await emitTrackMessageUpdated(boundTrackId);
    return {
      success: true,
      lyric: serializeLyricsResource(created, uploaderNames),
      boundTrackId,
      autoBound,
      ...(candidateTrackIds.length ? { candidateTrackIds } : {}),
      ...(bindConflict ? { bindConflict } : {})
    };
  });

  app.post("/api/music/resources/scores", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedMusicRequest).auth;
    let processed;
    try {
      processed = await processScoreImageParts(
        request.files({ limits: { files: 20, fileSize: 20 * 1024 * 1024, parts: 22 } }),
        { musicScoreDir, imageWebpEffort, displayWebpFileName }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "歌谱上传失败";
      request.log.warn({ error }, "music score resource upload failed");
      return reply.code(400).send({ success: false, message });
    }
    const fail = (code: number, message: string) => {
      processed.discard();
      return reply.code(code).send({ success: false, message });
    };

    const fields = processed.firstPartFields;
    let boundTrackId: number | null = null;
    let autoBound = false;
    let candidateTrackIds: number[] = [];
    if (fields.trackId?.trim()) {
      const requestedTrackId = Number(fields.trackId);
      if (!Number.isInteger(requestedTrackId) || requestedTrackId <= 0) return fail(400, "歌曲参数无效");
      const track = await findMusicTrack(requestedTrackId);
      if (!track) return fail(404, "歌曲不存在");
      if (!canManageMusicAsset(auth, track.sender.accountId)) return fail(403, "只能管理自己上传的音乐");
      boundTrackId = track.id;
    } else {
      const matches = await matchTracksByStem(fileStem(processed.firstFileName || ""));
      if (matches.length === 1) {
        boundTrackId = matches[0].id;
        autoBound = true;
      } else if (matches.length > 1) {
        candidateTrackIds = matches.map((match) => match.id);
      }
    }

    const title = fields.title?.trim().slice(0, 255) || fileStem(processed.firstFileName || "").slice(0, 255) || "歌谱";
    let score;
    try {
      score = await prisma.musicScore.create({
        data: { trackId: boundTrackId, title, uploadedByAccountId: auth.accountId, pages: { create: processed.pages } },
        include: { pages: { orderBy: { pageIndex: "asc" }, select: { id: true, pageIndex: true, fileName: true } } }
      });
    } catch (error) {
      request.log.warn({ error }, "music score resource create failed");
      return fail(400, "歌谱保存失败，请重试");
    }
    const uploaderNames = await loadUploaderNames([score.uploadedByAccountId]);
    io.emit("music:updated", { action: "score-added", trackId: boundTrackId, scoreId: score.id });
    return {
      success: true,
      score: serializeScoreResource(score, uploaderNames),
      boundTrackId,
      autoBound,
      ...(candidateTrackIds.length ? { candidateTrackIds } : {}),
      ...(boundTrackId ? { track: await emitAndSerializeTrack(boundTrackId) } : {})
    };
  });

  app.get("/api/music/resources", { preHandler: requireAuth }, async () => {
    const [lyricsRows, scoreRows] = await Promise.all([
      prisma.musicLyrics.findMany({ where: { trackId: null }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
      prisma.musicScore.findMany({
        where: { trackId: null },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: { pages: { orderBy: { pageIndex: "asc" }, select: { id: true, pageIndex: true, fileName: true } } }
      })
    ]);
    const uploaderNames = await loadUploaderNames([
      ...lyricsRows.map((row) => row.uploadedByAccountId),
      ...scoreRows.map((row) => row.uploadedByAccountId)
    ]);
    return {
      lyrics: lyricsRows.map((row) => serializeLyricsResource(row, uploaderNames)),
      scores: scoreRows.map((row) => serializeScoreResource(row, uploaderNames))
    };
  });

  app.post("/api/music/lyrics/:id/bind", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedMusicRequest).auth;
    const lyricId = Number((request.params as { id: string }).id);
    const body = z.object({ trackId: z.number().int().positive() }).parse(request.body);
    const lyric = await prisma.musicLyrics.findUnique({ where: { id: lyricId } });
    if (!lyric) return reply.code(404).send({ success: false, message: "歌词不存在" });
    if (!(await canMutateResource(auth, lyric))) {
      return reply.code(403).send({ success: false, message: "只能管理自己上传的歌词" });
    }
    const target = await findMusicTrack(body.trackId);
    if (!target) return reply.code(404).send({ success: false, message: "歌曲不存在" });
    if (!canManageMusicAsset(auth, target.sender.accountId)) {
      return reply.code(403).send({ success: false, message: "只能管理自己上传的音乐" });
    }
    const existing = await prisma.musicLyrics.findUnique({ where: { trackId: target.id }, select: { id: true } });
    if (existing && existing.id !== lyric.id) {
      return reply.code(409).send({ success: false, message: "该歌曲已有歌词，请先解绑或删除原有歌词" });
    }
    const previousTrackId = lyric.trackId;
    await prisma.musicLyrics.update({ where: { id: lyricId }, data: { trackId: target.id } });
    io.emit("music:updated", { action: "lyrics-bound", trackId: target.id, lyricId });
    const track = await emitAndSerializeTrack(target.id);
    if (previousTrackId && previousTrackId !== target.id) await emitTrackMessageUpdated(previousTrackId);
    return { success: true, boundTrackId: target.id, track };
  });

  app.post("/api/music/lyrics/:id/unbind", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedMusicRequest).auth;
    const lyricId = Number((request.params as { id: string }).id);
    const lyric = await prisma.musicLyrics.findUnique({ where: { id: lyricId } });
    if (!lyric) return reply.code(404).send({ success: false, message: "歌词不存在" });
    if (!(await canMutateResource(auth, lyric))) {
      return reply.code(403).send({ success: false, message: "只能管理自己上传的歌词" });
    }
    const previousTrackId = lyric.trackId;
    if (previousTrackId) {
      await prisma.musicLyrics.update({ where: { id: lyricId }, data: { trackId: null } });
      io.emit("music:updated", { action: "lyrics-unbound", trackId: previousTrackId, lyricId });
      await emitTrackMessageUpdated(previousTrackId);
    }
    const uploaderNames = await loadUploaderNames([lyric.uploadedByAccountId]);
    return { success: true, lyric: serializeLyricsResource(lyric, uploaderNames) };
  });

  app.post("/api/music/scores/:id/bind", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedMusicRequest).auth;
    const scoreId = Number((request.params as { id: string }).id);
    const body = z.object({ trackId: z.number().int().positive() }).parse(request.body);
    const score = await prisma.musicScore.findUnique({ where: { id: scoreId } });
    if (!score) return reply.code(404).send({ success: false, message: "歌谱不存在" });
    if (!(await canMutateResource(auth, score))) {
      return reply.code(403).send({ success: false, message: "只能管理自己上传的歌谱" });
    }
    const target = await findMusicTrack(body.trackId);
    if (!target) return reply.code(404).send({ success: false, message: "歌曲不存在" });
    if (!canManageMusicAsset(auth, target.sender.accountId)) {
      return reply.code(403).send({ success: false, message: "只能管理自己上传的音乐" });
    }
    const previousTrackId = score.trackId;
    await prisma.musicScore.update({ where: { id: scoreId }, data: { trackId: target.id } });
    io.emit("music:updated", { action: "score-bound", trackId: target.id, scoreId });
    const track = await emitAndSerializeTrack(target.id);
    if (previousTrackId && previousTrackId !== target.id) await emitTrackMessageUpdated(previousTrackId);
    return { success: true, boundTrackId: target.id, track };
  });

  app.post("/api/music/scores/:id/unbind", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedMusicRequest).auth;
    const scoreId = Number((request.params as { id: string }).id);
    const score = await prisma.musicScore.findUnique({
      where: { id: scoreId },
      include: { pages: { orderBy: { pageIndex: "asc" }, select: { id: true, pageIndex: true, fileName: true } } }
    });
    if (!score) return reply.code(404).send({ success: false, message: "歌谱不存在" });
    if (!(await canMutateResource(auth, score))) {
      return reply.code(403).send({ success: false, message: "只能管理自己上传的歌谱" });
    }
    const previousTrackId = score.trackId;
    if (previousTrackId) {
      await prisma.musicScore.update({ where: { id: scoreId }, data: { trackId: null } });
      io.emit("music:updated", { action: "score-unbound", trackId: previousTrackId, scoreId });
      await emitTrackMessageUpdated(previousTrackId);
    }
    const uploaderNames = await loadUploaderNames([score.uploadedByAccountId]);
    return { success: true, score: serializeScoreResource(score, uploaderNames) };
  });

  app.delete("/api/music/resources/lyrics/:id", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedMusicRequest).auth;
    const lyricId = Number((request.params as { id: string }).id);
    const lyric = await prisma.musicLyrics.findUnique({ where: { id: lyricId } });
    if (!lyric) return reply.code(404).send({ success: false, message: "歌词不存在" });
    if (lyric.trackId) {
      return reply.code(400).send({ success: false, message: "该歌词已绑定歌曲，请先解绑或通过曲目接口删除" });
    }
    if (!canManageMusicRole(auth) && lyric.uploadedByAccountId !== auth.accountId) {
      return reply.code(403).send({ success: false, message: "只能删除自己上传的歌词" });
    }
    await prisma.musicLyrics.delete({ where: { id: lyricId } });
    io.emit("music:updated", { action: "lyrics-deleted", lyricId });
    return { success: true };
  });

  app.delete("/api/music/resources/scores/:id", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedMusicRequest).auth;
    const scoreId = Number((request.params as { id: string }).id);
    const score = await prisma.musicScore.findUnique({
      where: { id: scoreId },
      include: { pages: { select: { filePath: true } } }
    });
    if (!score) return reply.code(404).send({ success: false, message: "歌谱不存在" });
    if (score.trackId) {
      return reply.code(400).send({ success: false, message: "该歌谱已绑定歌曲，请先解绑或通过曲目接口删除" });
    }
    if (!canManageMusicRole(auth) && score.uploadedByAccountId !== auth.accountId) {
      return reply.code(403).send({ success: false, message: "只能删除自己上传的歌谱" });
    }
    await prisma.musicScore.delete({ where: { id: scoreId } });
    for (const page of score.pages) safeUnlinkMusicScore(page.filePath);
    io.emit("music:updated", { action: "score-deleted", scoreId });
    return { success: true };
  });

  app.post("/api/music/tracks/:id/ai-info", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedMusicRequest).auth;
    const id = Number((request.params as { id: string }).id);
    const body = z.object({ overwrite: z.boolean().optional().default(false) }).parse(request.body || {});
    const track = await prisma.message.findFirst({
      where: { id, channel: { kind: "music" }, type: "file" },
      include: { sender: true }
    });
    if (!track?.fileName || !isMusicFileName(track.fileName)) {
      return reply.code(404).send({ success: false, message: "歌曲不存在" });
    }
    if (!canManageMusicAsset(auth, track.sender.accountId)) {
      return reply.code(403).send({ success: false, message: "只能管理自己上传的音乐" });
    }
    if (!consumeAiInfoRateLimit(auth.accountId)) {
      return reply.code(429).send({ success: false, message: "生成太频繁了，请稍后再试" });
    }
    const info = musicTrackInfo(track.payload);
    if (!body.overwrite && (info.background || info.lyricsText)) {
      return reply.code(409).send({ success: false, message: "该歌曲已有写作背景或知识歌词，如需覆盖请确认后重试" });
    }
    const aiSettings = await loadAiSettings();
    const apiKey = decryptAiApiKey(aiSettings.encryptedApiKey);
    if (!aiSettings.value.enabled || !apiKey) {
      return reply.code(503).send({ success: false, message: "AI 功能未启用或未配置 API Key，请联系管理员" });
    }
    const title = musicTrackTitle(track.fileName);
    const contextText = `请补全诗歌《${title}》的写作背景和歌词。`;
    let raw: string;
    try {
      raw = await callLlm(
        [
          { role: "system", content: MUSIC_INFO_SYSTEM_PROMPT },
          { role: "user", content: contextText }
        ],
        { temperature: 0.7, maxTokens: 3000, timeoutMs: 60_000 }
      );
    } catch (error) {
      request.log.warn({ error, trackId: id }, "music ai-info generation failed");
      return reply.code(502).send({ success: false, message: "AI 生成失败，请稍后再试" });
    }
    const generated = parseMusicInfoResponse(raw);
    if (!generated) return reply.code(502).send({ success: false, message: "AI 返回的内容无法解析，请重试" });

    const currentPayload =
      track.payload && typeof track.payload === "object" && !Array.isArray(track.payload)
        ? { ...(track.payload as Record<string, unknown>) }
        : {};
    if (generated.background) currentPayload.background = generated.background;
    if (generated.lyricsText) currentPayload.lyricsText = generated.lyricsText;
    const updated = await prisma.message.update({
      where: { id },
      data: { payload: currentPayload as Prisma.InputJsonValue },
      include: {
        sender: true,
        musicScores: trackScoresInclude,
        musicLyrics: true,
        _count: { select: { musicPlays: true } }
      }
    });
    await prisma.messageAiSuggestion.create({
      data: {
        messageId: id,
        kind: "music_info",
        status: "success",
        promptCommand: MUSIC_INFO_SYSTEM_PROMPT,
        contextText,
        responseText: raw.slice(0, 20000),
        model: aiSettings.value.model,
        baseUrl: aiSettings.value.baseUrl,
        createdByAccountId: auth.accountId
      }
    });
    io.to(`ch:${track.channelId}`).emit("message:updated", await serializeMessage(updated));
    io.emit("music:updated", { action: "info-updated", trackId: id });
    return { success: true, track: musicService.serializeTrack(updated, 0, undefined, true) };
  });
}
