import type { Prisma, PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";

export type UnreadCountsAuthContext = {
  accountId: number;
  actorId: number;
  username: string;
  isAdmin: boolean;
  isGuest: boolean;
  canPinMessages: boolean;
  sessionId: string;
};

export type UnreadCountsRouteDependencies = {
  requireAuth: preHandlerHookHandler;
  prisma: PrismaClient;
  channelListWhere: (accountId: number, isGuest?: boolean) => Prisma.ChannelWhereInput;
};

const MAX_LAST_READ_ENTRIES = 200;

export function parseLastReadMap(raw: string): Record<number, number> {
  const result: Record<number, number> = {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return result;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const [key, entry] of Object.entries(value).slice(0, MAX_LAST_READ_ENTRIES)) {
    const channelId = Number(key);
    const messageId = Math.floor(Number(entry));
    if (!Number.isInteger(channelId) || channelId <= 0) continue;
    if (!Number.isFinite(messageId) || messageId < 0) continue;
    result[channelId] = messageId;
  }
  return result;
}

// Batched replacement for the per-channel "fetch messages after lastRead and
// count them" startup seeding: one grouped count instead of N serialized
// full message payloads.
export function registerUnreadCountsRoutes(app: FastifyInstance, deps: UnreadCountsRouteDependencies) {
  app.get("/api/messages/unread-counts", { preHandler: deps.requireAuth }, async (request: FastifyRequest) => {
    const auth = (request as FastifyRequest & { auth: UnreadCountsAuthContext }).auth;
    const query = z.object({ lastRead: z.string().max(8192).default("{}") }).parse(request.query);
    const lastRead = parseLastReadMap(query.lastRead);
    const requestedIds = Object.keys(lastRead).map(Number);
    if (!requestedIds.length) return { counts: {} as Record<number, number> };

    const accessible = await deps.prisma.channel.findMany({
      where: { AND: [{ id: { in: requestedIds } }, deps.channelListWhere(auth.accountId, auth.isGuest)] },
      select: { id: true }
    });
    const conditions = accessible.map((channel) => ({ channelId: channel.id, id: { gt: lastRead[channel.id] } }));
    if (!conditions.length) return { counts: {} as Record<number, number> };

    const rows = await deps.prisma.message.groupBy({
      by: ["channelId"],
      where: {
        AND: [{ OR: conditions }, { NOT: { sender: { accountId: auth.accountId } } }]
      },
      _count: { _all: true }
    });
    const counts: Record<number, number> = {};
    for (const row of rows) counts[row.channelId] = row._count._all;
    return { counts };
  });
}
