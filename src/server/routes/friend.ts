import fs from "node:fs";
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { FriendProgramDTO } from "../../shared/types.js";
import type { FriendCachedMedia, FriendFeedService } from "../friendFeed.js";

export type FriendRouteDependencies = {
  requireAuth: preHandlerHookHandler;
  requireMediaAuth: preHandlerHookHandler;
  feedService: FriendFeedService;
};

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
  const { requireAuth, requireMediaAuth, feedService } = deps;

  app.get("/api/friend/programs", { preHandler: requireAuth }, async (_request, reply) => {
    try {
      const programs: FriendProgramDTO[] = await feedService.getPrograms();
      return { programs };
    } catch {
      return reply.code(502).send({ success: false, message: "节目单暂时无法获取，请稍后重试" });
    }
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
