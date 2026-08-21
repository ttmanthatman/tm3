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
  emitRead: (accountId: number, event: { channelId: number; lastReadMessageId: number; unreadCount: number }) => void;
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

export function resolveReadPositions(
  channelIds: number[],
  latestByChannel: ReadonlyMap<number, number>,
  storedByChannel: ReadonlyMap<number, number>,
  localHints: Readonly<Record<number, number>>
) {
  const result: Record<number, number> = {};
  for (const channelId of channelIds) {
    const latest = Math.max(0, latestByChannel.get(channelId) ?? 0);
    const stored = storedByChannel.get(channelId);
    const hint = localHints[channelId];
    const candidate = stored === undefined && hint === undefined ? latest : Math.max(stored ?? 0, hint ?? 0);
    result[channelId] = Math.min(candidate, latest);
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
    const accessible = await deps.prisma.channel.findMany({
      where: deps.channelListWhere(auth.accountId, auth.isGuest),
      select: { id: true }
    });
    const channelIds = accessible.map((channel) => channel.id);
    if (!channelIds.length) return { counts: {} as Record<number, number>, lastRead: {} as Record<number, number> };

    const [latestRows, storedRows] = await Promise.all([
      deps.prisma.message.groupBy({ by: ["channelId"], where: { channelId: { in: channelIds } }, _max: { id: true } }),
      deps.prisma.channelRead.findMany({ where: { accountId: auth.accountId, channelId: { in: channelIds } }, select: { channelId: true, lastReadMessageId: true } })
    ]);
    const latestByChannel = new Map(latestRows.map((row) => [row.channelId, row._max.id ?? 0]));
    const storedByChannel = new Map(storedRows.map((row) => [row.channelId, row.lastReadMessageId]));
    const positions = resolveReadPositions(channelIds, latestByChannel, storedByChannel, lastRead);

    const missingChannelIds = channelIds.filter((channelId) => !storedByChannel.has(channelId));
    const advancingChannelIds = channelIds.filter((channelId) => !storedByChannel.has(channelId) || (storedByChannel.get(channelId) ?? 0) < positions[channelId]);
    await deps.prisma.$transaction(async (tx) => {
      if (missingChannelIds.length) {
        await tx.channelRead.createMany({
          data: missingChannelIds.map((channelId) => ({ channelId, accountId: auth.accountId, lastReadMessageId: positions[channelId] })),
          skipDuplicates: true
        });
      }
      for (const channelId of advancingChannelIds) {
        await tx.channelRead.updateMany({
          where: { channelId, accountId: auth.accountId, lastReadMessageId: { lt: positions[channelId] } },
          data: { lastReadMessageId: positions[channelId] }
        });
      }
    });

    const conditions = channelIds
      .filter((channelId) => (latestByChannel.get(channelId) ?? 0) > positions[channelId])
      .map((channelId) => ({ channelId, id: { gt: positions[channelId] } }));
    const counts: Record<number, number> = Object.fromEntries(channelIds.map((channelId) => [channelId, 0]));
    if (!conditions.length) return { counts, lastRead: positions };

    const rows = await deps.prisma.message.groupBy({
      by: ["channelId"],
      where: {
        AND: [{ OR: conditions }, { NOT: { sender: { accountId: auth.accountId } } }]
      },
      _count: { _all: true }
    });
    for (const row of rows) counts[row.channelId] = row._count._all;
    return { counts, lastRead: positions };
  });

  app.put("/api/channels/:id/read", { preHandler: deps.requireAuth }, async (request: FastifyRequest, reply) => {
    const auth = (request as FastifyRequest & { auth: UnreadCountsAuthContext }).auth;
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(request.params);
    const body = z.object({ lastReadMessageId: z.number().int().nonnegative() }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ success: false, message: "已读位置无效" });
    const channelId = params.data.id;
    const channel = await deps.prisma.channel.findFirst({
      where: { AND: [{ id: channelId }, deps.channelListWhere(auth.accountId, auth.isGuest)] },
      select: { id: true }
    });
    if (!channel) return reply.code(404).send({ success: false, message: "频道不存在" });

    const latest = await deps.prisma.message.aggregate({ where: { channelId }, _max: { id: true } });
    const requestedPosition = Math.min(body.data.lastReadMessageId, latest._max.id ?? 0);
    await deps.prisma.$transaction(async (tx) => {
      await tx.channelRead.createMany({ data: [{ channelId, accountId: auth.accountId, lastReadMessageId: requestedPosition }], skipDuplicates: true });
      await tx.channelRead.updateMany({
        where: { channelId, accountId: auth.accountId, lastReadMessageId: { lt: requestedPosition } },
        data: { lastReadMessageId: requestedPosition }
      });
    });
    const read = await deps.prisma.channelRead.findUnique({
      where: { channelId_accountId: { channelId, accountId: auth.accountId } },
      select: { lastReadMessageId: true }
    });
    const lastReadMessageId = read?.lastReadMessageId ?? requestedPosition;
    const unreadCount = await deps.prisma.message.count({
      where: { channelId, id: { gt: lastReadMessageId }, NOT: { sender: { accountId: auth.accountId } } }
    });
    const event = { channelId, lastReadMessageId, unreadCount };
    deps.emitRead(auth.accountId, event);
    return event;
  });
}
