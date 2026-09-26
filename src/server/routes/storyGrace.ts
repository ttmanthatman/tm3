import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { MessageDTO } from "../../shared/types.js";
import { createStoryGraceService, StoryGraceError } from "../services/storyGrace.js";
import { pushOriginFromHeaders } from "../pushOrigin.js";

type AuthRequest = FastifyRequest & { auth: { accountId: number; actorId: number } };
export interface StoryGraceRouteDependencies {
  prisma: PrismaClient;
  requireAuth: preHandlerHookHandler;
  directories: { stories: string; uploads: string };
  canWriteChannel(accountId: number, channelId: number): Promise<boolean>;
  hydrateMessage(messageId: number, accountId: number): Promise<MessageDTO | null>;
  emitMessage(messageId: number): Promise<unknown>;
  sendMessagePush(messageId: number, origin: string): Promise<void>;
}

export function registerStoryGraceRoutes(app: FastifyInstance, deps: StoryGraceRouteDependencies) {
  const service = createStoryGraceService(deps.prisma, deps.directories);
  app.post("/api/stories/:storyId/forward-grace", { preHandler: deps.requireAuth, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const params = z.object({ storyId: z.coerce.number().int().positive().safe() }).safeParse(request.params);
    const body = z.object({ channelId: z.number().int().positive().safe(), clientRequestId: z.string().uuid() }).strict().safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ success: false, message: "转发参数无效" });
    const auth = (request as AuthRequest).auth;
    const account = await deps.prisma.account.findUnique({ where: { id: auth.accountId }, select: { isGuest: true, actor: { select: { id: true, kind: true } } } });
    if (!account || account.isGuest || account.actor?.kind !== "human" || account.actor.id !== auth.actorId) return reply.code(403).send({ success: false, message: "只有正式账号可以转发自己的故事" });
    const channel = await deps.prisma.channel.findUnique({ where: { id: body.data.channelId }, select: { kind: true } });
    if (!channel || (channel.kind !== "standard" && channel.kind !== "direct")) return reply.code(400).send({ success: false, message: "请选择普通聊天室或私聊" });
    if (!(await deps.canWriteChannel(auth.accountId, body.data.channelId))) return reply.code(403).send({ success: false, message: "无权在此频道发言" });
    try {
      const result = await service.forward({ ...auth, ...params.data, ...body.data });
      if (result.state === "created") {
        await deps.emitMessage(result.messageId).catch((error) => request.log.error({ error, messageId: result.messageId }, "story grace broadcast failed"));
        void deps.sendMessagePush(result.messageId, pushOriginFromHeaders(request.headers)).catch((error) => request.log.warn({ error, messageId: result.messageId }, "story grace push failed"));
      }
      const message = await deps.hydrateMessage(result.messageId, auth.accountId);
      if (!message) return reply.code(404).send({ success: false, message: "恩典卡片已不可用" });
      return { success: true, message };
    } catch (error) {
      if (error instanceof StoryGraceError) return reply.code(error.statusCode).send({ success: false, message: error.message });
      request.log.error({ error }, "story grace forwarding failed");
      return reply.code(500).send({ success: false, message: "转发失败，请稍后重试" });
    }
  });
}
