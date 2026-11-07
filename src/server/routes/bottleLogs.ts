import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { AdminBottleLog, BottleLogRecord } from "../../shared/social.js";

export function registerBottleLogRoutes(app: FastifyInstance, deps: { prisma: PrismaClient; requireAdmin: preHandlerHookHandler }) {
  app.get("/api/admin/bottle-logs", { preHandler: deps.requireAdmin }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const parsed = z.object({ limit: z.coerce.number().int().min(1).max(500).default(300) }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ success: false, message: "日志参数无效" });
    const { prisma } = deps;
    const rows = await prisma.setting.findMany({
      where: { key: { startsWith: "bottle-log:" } },
      orderBy: [{ updatedAt: "desc" }, { key: "desc" }], take: parsed.data.limit
    });
    const records = rows.map((row) => JSON.parse(row.value) as BottleLogRecord);
    const accountIds = [...new Set(records.flatMap((row) => [row.senderAccountId, row.readerAccountId]).filter((id): id is number => id !== null))];
    const [accounts, channels] = await Promise.all([
      prisma.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, username: true, displayName: true } }),
      prisma.channel.findMany({ where: { id: { in: [...new Set(records.map((row) => row.channelId))] } }, select: { id: true, name: true } })
    ]);
    const accountById = new Map(accounts.map((account) => [account.id, account]));
    const channelById = new Map(channels.map((channel) => [channel.id, channel.name]));
    const name = (id: number | null) => id === null ? null : accountById.get(id)?.displayName || accountById.get(id)?.username || `已删除账号 #${id}`;
    const logs: AdminBottleLog[] = records.map((row) => ({
      ...row, channelName: channelById.get(row.channelId) || `已删除频道 #${row.channelId}`,
      senderName: name(row.senderAccountId), senderUsername: accountById.get(row.senderAccountId ?? -1)?.username ?? null,
      readerName: name(row.readerAccountId), readerUsername: accountById.get(row.readerAccountId ?? -1)?.username ?? null
    }));
    return { logs };
  });
}
