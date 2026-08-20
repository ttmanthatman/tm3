import type { PrismaClient } from "@prisma/client";

export type ReceptionServiceDeps = {
  prisma: PrismaClient;
  deleteChannelWithAttachments: (channelId: number) => Promise<void>;
  disconnectAccounts: (accountIds: number[]) => void;
  invalidateAccounts: (accountIds: number[]) => void;
  notifyRoomClosing: (channelId: number) => void;
  onError?: (error: unknown, channelId?: number) => void;
};

export function createReceptionService(deps: ReceptionServiceDeps) {
  let cleanupRunning = false;

  async function deleteRoom(channelId: number) {
    const room = await deps.prisma.channel.findFirst({
      where: { id: channelId, kind: "reception" },
      include: {
        members: {
          where: { account: { isGuest: true } },
          select: { accountId: true }
        }
      }
    });
    if (!room) return false;
    const guestIds = room.members.map((member) => member.accountId);
    const messageIds = await deps.prisma.message.findMany({ where: { channelId }, select: { id: true } });
    const engineEvents = await deps.prisma.engineEvent.findMany({
      where: {
        OR: [
          { channelId },
          ...(messageIds.length ? [{ messageId: { in: messageIds.map((message) => message.id) } }] : [])
        ]
      },
      select: { id: true }
    });
    deps.notifyRoomClosing(channelId);
    deps.disconnectAccounts(guestIds);
    deps.invalidateAccounts(guestIds);
    await deps.prisma.$transaction([
      deps.prisma.engineAction.deleteMany({ where: { eventId: { in: engineEvents.map((event) => event.id) } } }),
      deps.prisma.engineEvent.deleteMany({ where: { id: { in: engineEvents.map((event) => event.id) } } }),
      deps.prisma.accountActivityLog.deleteMany({ where: { OR: [{ channelId }, { accountId: { in: guestIds } }] } }),
      deps.prisma.accountLoginLog.deleteMany({ where: { accountId: { in: guestIds } } }),
      deps.prisma.auditLog.deleteMany({ where: { accountId: { in: guestIds } } })
    ]);
    await deps.deleteChannelWithAttachments(channelId);
    if (guestIds.length) {
      await deps.prisma.account.deleteMany({ where: { id: { in: guestIds }, isGuest: true } });
    }
    return true;
  }

  async function cleanupExpiredRooms() {
    if (cleanupRunning) return 0;
    cleanupRunning = true;
    try {
      const rooms = await deps.prisma.channel.findMany({
        where: { kind: "reception", receptionExpiresAt: { lte: new Date() } },
        select: { id: true },
        orderBy: { id: "asc" }
      });
      let deleted = 0;
      for (const room of rooms) {
        try {
          if (await deleteRoom(room.id)) deleted += 1;
        } catch (error) {
          deps.onError?.(error, room.id);
        }
      }
      return deleted;
    } finally {
      cleanupRunning = false;
    }
  }

  function startCleanupTimer(intervalMs = 60_000) {
    void cleanupExpiredRooms().catch((error) => deps.onError?.(error));
    const timer = setInterval(() => {
      void cleanupExpiredRooms().catch((error) => deps.onError?.(error));
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  return { deleteRoom, cleanupExpiredRooms, startCleanupTimer };
}
