import type { PrismaClient, DeviceKind } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { AdminLoginLogKind } from "../../shared/types.js";
import { activityLogCategory, friendlyDeviceName } from "../../shared/activityLog.js";
import { musicTrackTitle } from "../music.js";

export function registerAdminLogRoutes(app: FastifyInstance, deps: { prisma: PrismaClient; requireAdmin: preHandlerHookHandler }) {
  const { prisma, requireAdmin } = deps;

    async function adminActivityLogs(request: FastifyRequest, reply: FastifyReply) {
    const parsed = z
      .object({
        limit: z.coerce.number().int().min(1).max(500).default(300),
        category: z.enum(["all", "session", "music", "usage"]).default("all")
      })
      .safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ success: false, message: "日志参数无效" });
    const sourceLimit = Math.min(1000, parsed.data.limit * 3);
    const activityRows = await prisma.$queryRaw<
      Array<{
        id: number;
        kind: AdminLoginLogKind;
        accountId: number;
        username: string | null;
        displayName: string | null;
        deviceKind: DeviceKind | null;
        deviceName: string | null;
        ipAddress: string | null;
        userAgent: string | null;
        sessionId: string | null;
        channelId: number | null;
        channelName: string | null;
        trackId: number | null;
        trackFileName: string | null;
        playbackId: string | null;
        appVersion: string | null;
        latestVersion: string | null;
        isLatestVersion: boolean | number | null;
        state: string | null;
        progressMs: number | null;
        listenedMs: number | null;
        durationMs: number | null;
        createdAt: Date;
      }>
    >`
      SELECT
        log.id,
        log.kind,
        log.account_id AS accountId,
        account.username AS username,
        account.display_name AS displayName,
        log.device_kind AS deviceKind,
        log.device_name AS deviceName,
        log.ip_address AS ipAddress,
        log.user_agent AS userAgent,
        log.session_id AS sessionId,
        log.channel_id AS channelId,
        channel.name AS channelName,
        log.track_id AS trackId,
        track.file_name AS trackFileName,
        log.playback_id AS playbackId,
        log.app_version AS appVersion,
        log.latest_version AS latestVersion,
        log.is_latest_version AS isLatestVersion,
        log.event_state AS state,
        log.progress_ms AS progressMs,
        log.listened_ms AS listenedMs,
        log.duration_ms AS durationMs,
        log.created_at AS createdAt
      FROM account_activity_logs log
      LEFT JOIN accounts account ON account.id = log.account_id
      LEFT JOIN channels channel ON channel.id = log.channel_id
      LEFT JOIN messages track ON track.id = log.track_id
      WHERE (account.is_guest = FALSE OR account.is_guest IS NULL)
        AND (channel.kind <> 'reception' OR channel.kind IS NULL)
      ORDER BY log.created_at DESC, log.id DESC
      LIMIT ${sourceLimit}
    `;
    const legacyRows = await prisma.$queryRaw<
      Array<{
        id: number;
        kind: AdminLoginLogKind;
        accountId: number;
        username: string | null;
        displayName: string | null;
        deviceKind: DeviceKind | null;
        deviceName: string | null;
        ipAddress: string | null;
        userAgent: string | null;
        sessionId: string | null;
        createdAt: Date;
      }>
    >`
      SELECT
        log.id,
        log.kind,
        log.account_id AS accountId,
        account.username AS username,
        account.display_name AS displayName,
        log.device_kind AS deviceKind,
        log.device_name AS deviceName,
        log.ip_address AS ipAddress,
        log.user_agent AS userAgent,
        log.session_id AS sessionId,
        log.created_at AS createdAt
      FROM account_login_logs log
      LEFT JOIN accounts account ON account.id = log.account_id
      WHERE account.is_guest = FALSE OR account.is_guest IS NULL
      ORDER BY log.created_at DESC, log.id DESC
      LIMIT ${sourceLimit}
    `;
    const activityLogs = activityRows.map((row) => ({
      id: `activity-${row.id}`,
      kind: row.kind,
      category: activityLogCategory(row.kind),
      accountId: row.accountId,
      username: row.username || `user-${row.accountId}`,
      displayName: row.displayName || row.username || `用户 ${row.accountId}`,
      deviceKind: row.deviceKind,
      deviceName: row.deviceName || row.userAgent ? friendlyDeviceName(row.deviceName, row.userAgent || "") : null,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      sessionId: row.sessionId,
      channelId: row.channelId,
      channelName: row.channelName,
      trackId: row.trackId,
      trackTitle: row.trackFileName ? musicTrackTitle(row.trackFileName) : null,
      playbackId: row.playbackId,
      appVersion: row.appVersion,
      latestVersion: row.latestVersion,
      isLatestVersion: row.isLatestVersion === null ? null : !!row.isLatestVersion,
      state: row.state,
      progressMs: row.progressMs,
      listenedMs: row.listenedMs,
      durationMs: row.durationMs,
      createdAt: row.createdAt.toISOString()
    }));
    const legacyLogs = legacyRows.map((row) => ({
      id: `legacy-${row.id}`,
      kind: row.kind,
      category: "session" as const,
      accountId: row.accountId,
      username: row.username || `user-${row.accountId}`,
      displayName: row.displayName || row.username || `用户 ${row.accountId}`,
      deviceKind: row.deviceKind,
      deviceName: row.deviceName || row.userAgent ? friendlyDeviceName(row.deviceName, row.userAgent || "") : null,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      sessionId: row.sessionId,
      createdAt: row.createdAt.toISOString()
    }));
    const logs = [...activityLogs, ...legacyLogs]
      .filter((row) => parsed.data.category === "all" || row.category === parsed.data.category)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, parsed.data.limit);
    return { logs };
}

  app.get("/api/admin/activity-logs", { preHandler: requireAdmin }, adminActivityLogs);
  app.get("/api/admin/login-logs", { preHandler: requireAdmin }, adminActivityLogs);
}
