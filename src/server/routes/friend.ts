import fs from "node:fs";
import { Readable } from "node:stream";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { FriendPlaybackDTO, FriendProgramDTO } from "../../shared/types.js";
import { friendMediaProxyPath, type FriendCachedMedia, type FriendFeedService } from "../friendFeed.js";

export type FriendAuthContext = {
  accountId: number;
  actorId: number;
  username: string;
  isAdmin: boolean;
  canPinMessages: boolean;
  sessionId: string;
};

export type AuthedFriendRequest = FastifyRequest & { auth: FriendAuthContext };

export type FriendRouteDependencies = {
  requireAuth: preHandlerHookHandler;
  requireMediaAuth: preHandlerHookHandler;
  feedService: FriendFeedService;
  prisma: PrismaClient;
};

const FRIEND_HISTORY_LIMIT = 20;

const friendPlaybackBodySchema = z.object({
  seriesTitle: z.string().trim().min(1).max(190),
  title: z.string().trim().min(1).max(255),
  audioUrl: z.string().trim().min(1).max(512),
  imageUrl: z.string().trim().min(1).max(512).nullish(),
  progressMs: z.number().int().min(0).max(24 * 60 * 60 * 1000),
  durationMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).default(0)
});

function unwrapFriendMediaUrl(raw: string): string | null {
  const prefix = "/api/friend/media?u=";
  if (!raw.startsWith(prefix)) return raw;
  try {
    return decodeURIComponent(raw.slice(prefix.length));
  } catch {
    return null;
  }
}

function toFriendPlaybackDTO(row: {
  programId: string;
  seriesTitle: string;
  title: string;
  audioUrl: string;
  imageUrl: string | null;
  progressMs: number;
  durationMs: number;
  playedAt: Date;
}): FriendPlaybackDTO {
  return {
    programId: row.programId,
    seriesTitle: row.seriesTitle,
    title: row.title,
    audioUrl: friendMediaProxyPath(row.audioUrl),
    imageUrl: row.imageUrl ? friendMediaProxyPath(row.imageUrl) : undefined,
    progressMs: Math.max(0, row.progressMs),
    durationMs: Math.max(0, row.durationMs),
    playedAt: row.playedAt.toISOString()
  };
}

function toWebStream(body: ReadableStream<Uint8Array>) {
  return body as Parameters<typeof Readable.fromWeb>[0];
}

function sendCachedMedia(request: FastifyRequest, reply: FastifyReply, cached: FriendCachedMedia) {
  const stat = fs.statSync(cached.filePath);
  reply.header("Accept-Ranges", "bytes");
  reply.header("Content-Type", cached.contentType);
  reply.header("Cache-Control", "public, max-age=86400");
  const range = request.headers.range;
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
        return reply.send(fs.createReadStream(cached.filePath, { start, end }));
      }
    }
    reply.code(416);
    reply.header("Content-Range", `bytes */${stat.size}`);
    return reply.send();
  }
  reply.header("Content-Length", String(stat.size));
  return reply.send(fs.createReadStream(cached.filePath));
}

export function registerFriendRoutes(app: FastifyInstance, deps: FriendRouteDependencies) {
  const { requireAuth, requireMediaAuth, feedService, prisma } = deps;

  app.get("/api/friend/programs", { preHandler: requireAuth }, async (_request, reply) => {
    try {
      const programs: FriendProgramDTO[] = await feedService.getPrograms();
      return { programs };
    } catch {
      return reply.code(502).send({ success: false, message: "节目单暂时无法获取，请稍后重试" });
    }
  });

  app.get("/api/friend/categories", { preHandler: requireAuth }, async (_request, reply) => {
    try {
      const categories = await feedService.getCategories();
      return { categories };
    } catch {
      return reply.code(502).send({ success: false, message: "节目分类暂时无法获取，请稍后重试" });
    }
  });

  app.get("/api/friend/series/:alias", { preHandler: requireAuth }, async (request, reply) => {
    const alias = String((request.params as { alias?: string }).alias || "");
    try {
      const programs: FriendProgramDTO[] = await feedService.getSeriesPrograms(alias);
      return { programs };
    } catch (error) {
      if (error instanceof Error && error.message === "不支持的节目系列") {
        return reply.code(400).send({ success: false, message: "不支持的节目系列" });
      }
      return reply.code(502).send({ success: false, message: "节目列表暂时无法获取，请稍后重试" });
    }
  });

  app.get("/api/friend/history", { preHandler: requireAuth }, async (request) => {
    const auth = (request as AuthedFriendRequest).auth;
    const rows = await prisma.friendPlayback.findMany({
      where: { accountId: auth.accountId },
      orderBy: { playedAt: "desc" },
      take: FRIEND_HISTORY_LIMIT
    });
    return { history: rows.map(toFriendPlaybackDTO) };
  });

  app.put("/api/friend/playback/:programId", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedFriendRequest).auth;
    const programId = String((request.params as { programId?: string }).programId || "").trim();
    if (!/^\d{1,20}$/.test(programId)) {
      return reply.code(400).send({ success: false, message: "无效的节目编号" });
    }
    const parsed = friendPlaybackBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, message: "无效的播放进度" });
    }
    const body = parsed.data;
    const audioUrl = unwrapFriendMediaUrl(body.audioUrl);
    const imageUrl = body.imageUrl ? unwrapFriendMediaUrl(body.imageUrl) : null;
    if (!audioUrl || !feedService.isAllowedMediaUrl(audioUrl)
      || (body.imageUrl && (!imageUrl || !feedService.isAllowedMediaUrl(imageUrl)))) {
      return reply.code(400).send({ success: false, message: "无效的播放进度" });
    }
    const row = await prisma.friendPlayback.upsert({
      where: { accountId_programId: { accountId: auth.accountId, programId } },
      create: {
        accountId: auth.accountId,
        programId,
        seriesTitle: body.seriesTitle,
        title: body.title,
        audioUrl,
        imageUrl,
        progressMs: body.progressMs,
        durationMs: body.durationMs
      },
      update: {
        seriesTitle: body.seriesTitle,
        title: body.title,
        audioUrl,
        imageUrl,
        progressMs: body.progressMs,
        durationMs: body.durationMs
      }
    });
    return { success: true, playback: toFriendPlaybackDTO(row) };
  });

  app.get("/api/friend/media", { preHandler: requireMediaAuth }, async (request, reply) => {
    const raw = String((request.query as { u?: string }).u || "");
    if (!raw) return reply.code(400).send({ success: false, message: "缺少媒体地址" });
    if (!feedService.isAllowedMediaUrl(raw)) return reply.code(403).send({ success: false, message: "不支持的媒体地址" });

    const range = request.headers.range || null;
    const cached = feedService.resolveCachedMedia(raw);
    if (cached) return sendCachedMedia(request, reply, cached);

    let media;
    try {
      media = await feedService.fetchMediaStream(raw, range);
    } catch {
      return reply.code(502).send({ success: false, message: "节目暂时无法播放，请稍后重试" });
    }

    reply.code(media.status === 206 ? 206 : 200);
    reply.header("Content-Type", media.contentType);
    reply.header("Accept-Ranges", "bytes");
    reply.header("Cache-Control", "public, max-age=3600");
    if (media.contentLength !== null) reply.header("Content-Length", String(media.contentLength));
    if (media.contentRange) reply.header("Content-Range", media.contentRange);

    if (!range && media.status === 200) {
      const [clientBranch, cacheBranch] = media.body.tee();
      if (feedService.isCachingMedia(raw)) {
        void cacheBranch.cancel().catch(() => undefined);
      } else {
        void feedService.storeMediaStream(raw, media.contentType, media.contentLength, cacheBranch).catch(() => undefined);
      }
      return reply.send(Readable.fromWeb(toWebStream(clientBranch)));
    }
    return reply.send(Readable.fromWeb(toWebStream(media.body)));
  });
}
