import type { PrismaClient, DeviceKind } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { AdminLoginLogDTO, AdminLoginLogKind } from "../../shared/types.js";
import { activityLogCategory, friendlyDeviceName } from "../../shared/activityLog.js";
import { musicTrackTitle } from "../music.js";

const AI_LOG_TEXT_LIMIT = 65_535;

function aiMessageLogText(message: { content: string | null; type: string; fileName: string | null }) {
  const content = (message.content || "").slice(0, AI_LOG_TEXT_LIMIT);
  if (message.type === "text" || message.type === "prayer" || message.type === "grace") return content;
  const fileName = (message.fileName || "").split(/[\\/]/).pop()?.slice(0, 255) || "";
  const labels: Record<string, string> = { image: "图片", file: "文件", music_playlist: "歌单", handwriting: "手写", system: "系统消息" };
  const label = labels[message.type] || "消息卡片";
  return [`[${label}${fileName ? `：${fileName}` : ""}]`, content].filter(Boolean).join("\n").slice(0, AI_LOG_TEXT_LIMIT);
}

export function registerAdminLogRoutes(app: FastifyInstance, deps: { prisma: PrismaClient; requireAdmin: preHandlerHookHandler }) {
  const { prisma, requireAdmin } = deps;

  async function adminActivityLogs(request: FastifyRequest, reply: FastifyReply) {
    const parsed = z
      .object({
        limit: z.coerce.number().int().min(1).max(500).default(300),
        category: z.enum(["all", "session", "music", "usage", "ai"]).default("all")
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
    // Read only exchanges with a virtual sender and a human question in the same channel.
    // This includes direct conversations without exposing unrelated human-to-human messages.
    const aiRows = parsed.data.category === "all" || parsed.data.category === "ai"
      ? await prisma.$queryRaw<Array<{
        answerId: number;
        questionId: number;
        accountId: number;
        username: string;
        displayName: string;
        aiRoleUsername: string;
        aiRoleName: string;
        channelId: number;
        channelName: string;
        channelKind: string;
        channelIsPrivate: boolean | number;
        questionContent: string | null;
        questionType: string;
        questionFileName: string | null;
        answerContent: string | null;
        answerType: string;
        answerFileName: string | null;
        createdAt: Date;
      }>>`
        SELECT
          answer.id AS answerId,
          question.id AS questionId,
          account.id AS accountId,
          account.username AS username,
          question_sender.display_name AS displayName,
          answer_sender.username AS aiRoleUsername,
          answer_sender.display_name AS aiRoleName,
          channel.id AS channelId,
          channel.name AS channelName,
          channel.kind AS channelKind,
          channel.is_private AS channelIsPrivate,
          question.content AS questionContent,
          question.type AS questionType,
          question.file_name AS questionFileName,
          answer.content AS answerContent,
          answer.type AS answerType,
          answer.file_name AS answerFileName,
          answer.created_at AS createdAt
        FROM messages answer
        INNER JOIN actors answer_sender ON answer_sender.id = answer.sender_actor_id AND answer_sender.kind = 'virtual'
        INNER JOIN messages question ON question.id = COALESCE(
          answer.reply_to_id,
          CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(answer.payload, '$.triggerMessageId')) REGEXP '^[1-9][0-9]*$'
            THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(answer.payload, '$.triggerMessageId')) AS UNSIGNED)
            ELSE NULL END
        ) AND question.channel_id = answer.channel_id
        INNER JOIN actors question_sender ON question_sender.id = question.sender_actor_id AND question_sender.kind = 'human'
        INNER JOIN accounts account ON account.id = question_sender.account_id AND account.is_guest = FALSE
        INNER JOIN channels channel ON channel.id = answer.channel_id AND channel.kind <> 'reception'
        ORDER BY answer.created_at DESC, answer.id DESC
        LIMIT ${sourceLimit}
      `
      : [];
    const aiLogs: AdminLoginLogDTO[] = aiRows.map((row) => ({
      id: `ai-${row.answerId}`,
      kind: "ai_exchange",
      category: "ai",
      accountId: row.accountId,
      username: row.username,
      displayName: row.displayName || row.username,
      channelId: row.channelId,
      channelName: row.channelName,
      aiRoleUsername: row.aiRoleUsername,
      aiRoleName: row.aiRoleName || row.aiRoleUsername,
      isPrivateConversation: row.channelKind === "direct" || !!row.channelIsPrivate,
      questionMessageId: row.questionId,
      answerMessageId: row.answerId,
      questionText: aiMessageLogText({ content: row.questionContent, type: row.questionType, fileName: row.questionFileName }),
      answerText: aiMessageLogText({ content: row.answerContent, type: row.answerType, fileName: row.answerFileName }),
      createdAt: row.createdAt.toISOString()
    }));
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
    const logs = [...activityLogs, ...legacyLogs, ...aiLogs]
      .filter((row) => parsed.data.category === "all" || row.category === parsed.data.category)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, parsed.data.limit);
    return { logs };
  }

  app.get("/api/admin/activity-logs", { preHandler: requireAdmin }, adminActivityLogs);
  app.get("/api/admin/login-logs", { preHandler: requireAdmin }, adminActivityLogs);
}
