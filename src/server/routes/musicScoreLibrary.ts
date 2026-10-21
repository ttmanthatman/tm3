import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthedMusicRequest, MusicRouteDependencies } from "./music.js";
import { pushOriginFromHeaders } from "../pushOrigin.js";
import {
  createMusicScoreShareService, musicScoreLibraryInclude, musicScoreReadStatus, MusicScoreShareError, serializeMusicScoreLibraryEntry
} from "../services/musicScoreLibrary.js";

type MusicScoreLibraryDependencies = Pick<MusicRouteDependencies,
  "prisma" | "requireAuth" | "canAccessChannel" | "canWriteChannel" | "isAudioFileName" | "musicScoreDir" | "uploadDir" | "emitMessage" | "sendMessagePush"
>;

export function registerMusicScoreLibraryRoutes(app: FastifyInstance, deps: MusicScoreLibraryDependencies) {
  const { prisma, requireAuth, canAccessChannel, canWriteChannel, isAudioFileName, emitMessage, sendMessagePush } = deps;
  const sharing = createMusicScoreShareService(prisma, { scores: deps.musicScoreDir, uploads: deps.uploadDir });
  const paramsSchema = z.object({ id: z.coerce.number().int().positive().safe() });

  app.get("/api/music/scores", { preHandler: requireAuth }, async (request) => {
    const auth = (request as AuthedMusicRequest).auth;
    const { search } = z.object({ search: z.string().trim().max(200).default("") }).parse(request.query);
    const rows = await prisma.musicScore.findMany({
      where: search ? { OR: [{ title: { contains: search } }, { track: { fileName: { contains: search } } }] } : {},
      include: musicScoreLibraryInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
    const channelAccess = new Map<number, Promise<boolean>>();
    const access = (accountId: number, channelId: number) => {
      if (!channelAccess.has(channelId)) channelAccess.set(channelId, canAccessChannel(accountId, channelId));
      return channelAccess.get(channelId)!;
    };
    const scores = [];
    for (const row of rows) {
      if (await musicScoreReadStatus(auth, row, access, isAudioFileName) === 200) scores.push(serializeMusicScoreLibraryEntry(row));
    }
    return { scores };
  });

  app.get("/api/music/scores/:id", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedMusicRequest).auth;
    const { id } = paramsSchema.parse(request.params);
    const score = await prisma.musicScore.findUnique({ where: { id }, include: musicScoreLibraryInclude });
    if (!score) return reply.code(404).send({ success: false, message: "歌谱不存在" });
    const status = await musicScoreReadStatus(auth, score, canAccessChannel, isAudioFileName);
    if (status !== 200) return reply.code(status).send({ success: false, message: status === 403 ? "无权查看歌谱" : "歌谱不存在" });
    return { score: serializeMusicScoreLibraryEntry(score) };
  });

  app.post("/api/music/scores/:id/share", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedMusicRequest).auth;
    const { id } = paramsSchema.parse(request.params);
    const body = z.object({ channelId: z.number().int().positive().safe(), clientRequestId: z.string().uuid() }).strict().parse(request.body);
    const score = await prisma.musicScore.findUnique({ where: { id }, include: musicScoreLibraryInclude });
    if (!score) return reply.code(404).send({ success: false, message: "歌谱不存在" });
    const status = await musicScoreReadStatus(auth, score, canAccessChannel, isAudioFileName);
    if (status !== 200) return reply.code(status).send({ success: false, message: status === 403 ? "无权查看歌谱" : "歌谱不存在" });
    const channel = await prisma.channel.findUnique({ where: { id: body.channelId }, select: { kind: true } });
    if (!channel || (channel.kind !== "standard" && channel.kind !== "direct")) return reply.code(400).send({ success: false, message: "歌谱只能分享到聊天频道或私聊" });
    if (!(await canWriteChannel(auth.accountId, body.channelId))) return reply.code(403).send({ success: false, message: "无权在所选聊天发言" });
    try {
      const result = await sharing.share({ score, actorId: auth.actorId, channelId: body.channelId, clientRequestId: body.clientRequestId });
      if (result.state === "created") {
        const origin = pushOriginFromHeaders(request.headers);
        for (const messageId of result.messageIds) {
          await emitMessage(messageId).catch((error) => request.log.warn({ error, messageId }, "score share emit failed"));
          void sendMessagePush(messageId, origin).catch((error) => request.log.warn({ error, messageId }, "score share push failed"));
        }
      }
      return { success: true, forwarded: result.messageIds.length, messageIds: result.messageIds, deduplicated: result.state === "replayed" };
    } catch (error) {
      if (error instanceof MusicScoreShareError) return reply.code(error.statusCode).send({ success: false, message: error.message });
      request.log.error({ error, scoreId: id }, "music score share failed");
      return reply.code(500).send({ success: false, message: "分享失败，请稍后重试" });
    }
  });
}
