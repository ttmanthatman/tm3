import type { Prisma, PrismaClient } from "@prisma/client";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

type AuthenticatedRequest = { auth: { accountId: number } };

export function registerMessageSearchRoutes(
  app: FastifyInstance,
  deps: { prisma: PrismaClient; requireAuth: preHandlerHookHandler }
) {
  app.get("/api/messages/search", { preHandler: deps.requireAuth }, async (request, reply) => {
    const auth = (request as typeof request & AuthenticatedRequest).auth;
    const parsed = z.object({
      query: z.string().trim().min(1).max(100),
      beforeId: z.coerce.number().int().positive().optional(),
      beforeCreatedAt: z.string().datetime().optional()
    }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ success: false, message: "搜索词无效" });

    const account = await deps.prisma.account.findUnique({
      where: { id: auth.accountId },
      select: { isGuest: true, guestExpiresAt: true }
    });
    if (!account) return reply.code(401).send({ success: false, message: "登录状态已失效" });
    if (account.isGuest && (!account.guestExpiresAt || account.guestExpiresAt <= new Date())) {
      return { results: [], nextCursor: null };
    }

    const channelWhere: Prisma.ChannelWhereInput = account.isGuest
      ? {
          kind: "reception",
          receptionExpiresAt: { gt: new Date() },
          members: { some: { accountId: auth.accountId } }
        }
      : {
          kind: { not: "aiLounge" },
          OR: [
            { kind: "music" },
            { isPrivate: false, directKey: null },
            { members: { some: { accountId: auth.accountId } } }
          ]
        };
    const channels = await deps.prisma.channel.findMany({ where: channelWhere, select: { id: true, name: true } });
    if (!channels.length) return { results: [], nextCursor: null };

    const limit = 30;
    const cursorFilter: Prisma.MessageWhereInput = parsed.data.beforeId && parsed.data.beforeCreatedAt
      ? {
          OR: [
            { createdAt: { lt: new Date(parsed.data.beforeCreatedAt) } },
            { createdAt: new Date(parsed.data.beforeCreatedAt), id: { lt: parsed.data.beforeId } }
          ]
        }
      : {};
    const rows = await deps.prisma.message.findMany({
      where: {
        channelId: { in: channels.map((channel) => channel.id) },
        content: { contains: parsed.data.query },
        ...cursorFilter
      },
      select: {
        id: true,
        channelId: true,
        content: true,
        createdAt: true,
        sender: { select: { displayName: true } }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const channelNames = new Map(channels.map((channel) => [channel.id, channel.name]));
    const results = page.map((message) => ({
      id: message.id,
      channelId: message.channelId,
      channelName: channelNames.get(message.channelId) || "聊天室",
      senderName: message.sender.displayName,
      content: message.content || "",
      createdAt: message.createdAt.toISOString()
    }));
    const last = page.at(-1);
    return {
      results,
      nextCursor: hasMore && last ? { id: last.id, createdAt: last.createdAt.toISOString() } : null
    };
  });
}
