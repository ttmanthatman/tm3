import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Prisma, type Message, type PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { ChatRecordItemDTO, ChatRecordPayloadDTO } from "../../shared/types.js";
import { imageDimensionsFromPayload } from "../../shared/imageDimensions.js";
import { pushOriginFromHeaders } from "../pushOrigin.js";

export type ForwardAuthContext = {
  accountId: number;
  actorId: number;
};

export type AuthedForwardRequest = FastifyRequest & { auth: ForwardAuthContext };

export type ForwardRouteDependencies = {
  prisma: PrismaClient;
  requireAuth: preHandlerHookHandler;
  canAccessChannel(accountId: number, channelId: number): Promise<boolean>;
  canWriteChannel(accountId: number, channelId: number): Promise<boolean>;
  emitMessage(messageId: number): Promise<unknown>;
  sendMessagePush(messageId: number, origin: string): Promise<void>;
  uploadDir: string;
};

const forwardBodySchema = z.object({
  messageIds: z.array(z.number().int().positive()).min(1).max(100),
  channelIds: z.array(z.number().int().positive()).min(1).max(20),
  mode: z.enum(["separate", "merged"])
});

// 只有纯内容型消息可以转发；接龙/祷告/讲道/系统消息等交互型消息不在白名单内。
const FORWARDABLE_TYPES = new Set(["text", "image", "file"]);
const RECORD_ITEM_TEXT_LIMIT = 2000;
const RECORD_PAYLOAD_BYTE_LIMIT = 1_000_000;

export type ForwardSourceMessage = Message & {
  sender: { displayName: string; avatarPath: string | null };
};

type VoicePayload = { kind: "voice"; durationMs?: unknown; mimeType?: unknown };

function voicePayload(payload: unknown): VoicePayload | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = payload as Record<string, unknown>;
  return value.kind === "voice" ? (value as unknown as VoicePayload) : null;
}

// 聊天记录条目的附件以拷贝后的 uploads 基名存放在 payload 里，
// 通过 /api/files/:messageId?item=<index> 按记录消息所在频道鉴权后提供。
export type ChatRecordStoredItem = ChatRecordItemDTO & { storedFile?: string };

export function chatRecordStoredFile(payload: unknown, itemIndex: number): { fileName: string; storedFile: string } | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = payload as Record<string, unknown>;
  if (value.kind !== "chat_record" || !Array.isArray(value.items)) return null;
  const item = value.items[itemIndex] as Record<string, unknown> | undefined;
  if (!item || typeof item.storedFile !== "string" || !item.storedFile) return null;
  return { fileName: typeof item.fileName === "string" && item.fileName ? item.fileName : item.storedFile, storedFile: item.storedFile };
}

function recordItemFromMessage(message: ForwardSourceMessage, storedFile?: string): ChatRecordStoredItem {
  const payload = message.payload && typeof message.payload === "object" && !Array.isArray(message.payload)
    ? (message.payload as Record<string, unknown>)
    : null;
  const base = {
    senderName: message.sender.displayName,
    senderAvatarPath: message.sender.avatarPath,
    createdAt: message.createdAt.toISOString()
  };
  if (message.type === "text") {
    return { ...base, type: "text", content: (message.content || "").slice(0, RECORD_ITEM_TEXT_LIMIT) };
  }
  const voice = voicePayload(payload);
  const dimensions = imageDimensionsFromPayload(payload);
  return {
    ...base,
    type: message.type === "image" ? "image" : "file",
    content: message.fileName || "",
    ...(message.fileName ? { fileName: message.fileName } : {}),
    ...(typeof message.fileSize === "number" ? { fileSize: message.fileSize } : {}),
    ...(storedFile ? { storedFile } : {}),
    ...(voice && typeof voice.durationMs === "number" ? { voiceDurationMs: Math.round(voice.durationMs) } : {}),
    ...(voice && typeof voice.mimeType === "string" ? { mimeType: voice.mimeType.slice(0, 80) } : {}),
    ...(dimensions ? { imageWidth: dimensions.width, imageHeight: dimensions.height } : {})
  };
}

function copyFileName(sourceFilePath: string, fallbackName: string | null) {
  const extension = path.extname(sourceFilePath).toLowerCase() || path.extname(fallbackName || "").toLowerCase() || ".bin";
  return `${randomUUID()}${extension}`;
}

export function registerForwardRoutes(app: FastifyInstance, deps: ForwardRouteDependencies) {
  const { prisma, requireAuth, canAccessChannel, canWriteChannel, emitMessage, sendMessagePush, uploadDir } = deps;

  // 多选转发：逐条复制消息，或合并为一条“聊天记录”快照卡片。
  // 附件一律物理拷贝，源消息被撤回/删除不影响已转发副本。
  app.post("/api/messages/forward", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedForwardRequest).auth;
    const parsed = forwardBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ success: false, message: "转发请求格式无效" });
    const body = parsed.data;
    const messageIds = [...new Set(body.messageIds)];
    const channelIds = [...new Set(body.channelIds)];

    const sources = (await prisma.message.findMany({
      where: { id: { in: messageIds } },
      include: { sender: { select: { displayName: true, avatarPath: true } } }
    })) as ForwardSourceMessage[];
    if (sources.length !== messageIds.length) return reply.code(404).send({ success: false, message: "部分消息不存在" });
    const sourceChannelIds = new Set(sources.map((message) => message.channelId));
    if (sourceChannelIds.size !== 1) return reply.code(400).send({ success: false, message: "只能转发同一聊天内的消息" });
    const sourceChannelId = sources[0].channelId;
    if (!(await canAccessChannel(auth.accountId, sourceChannelId))) {
      return reply.code(403).send({ success: false, message: "无权查看原聊天" });
    }

    const ordered = sources
      .sort((a, b) => a.id - b.id)
      .filter((message) => FORWARDABLE_TYPES.has(message.type) && (message.type === "text" ? Boolean(message.content?.trim()) : Boolean(message.filePath)));
    const skipped = sources.length - ordered.length;
    if (!ordered.length) return reply.code(400).send({ success: false, message: "所选消息类型不支持转发" });

    const targets = await prisma.channel.findMany({
      where: { id: { in: channelIds }, kind: { in: ["standard", "direct"] } },
      select: { id: true }
    });
    if (targets.length !== channelIds.length) return reply.code(400).send({ success: false, message: "目标聊天不存在或不支持转发" });
    for (const channelId of channelIds) {
      if (!(await canWriteChannel(auth.accountId, channelId))) {
        return reply.code(403).send({ success: false, message: "无权在所选聊天发言" });
      }
    }

    for (const message of ordered) {
      if (message.filePath && !fs.existsSync(path.join(uploadDir, path.basename(message.filePath)))) {
        return reply.code(404).send({ success: false, message: `附件文件不存在：${message.fileName || "文件"}` });
      }
    }

    const pushOrigin = pushOriginFromHeaders(request.headers);
    const copiedFiles: string[] = [];
    try {
      let forwarded = 0;
      if (body.mode === "separate") {
        const jobs: Array<{ channelId: number; message: ForwardSourceMessage; filePath?: string }> = [];
        for (const channelId of channelIds) {
          for (const message of ordered) {
            if (!message.filePath) {
              jobs.push({ channelId, message });
              continue;
            }
            const filePath = copyFileName(message.filePath, message.fileName);
            await fs.promises.copyFile(path.join(uploadDir, path.basename(message.filePath)), path.join(uploadDir, filePath));
            copiedFiles.push(filePath);
            jobs.push({ channelId, message, filePath });
          }
        }
        const created = await prisma.$transaction(
          jobs.map((job) =>
            prisma.message.create({
              data: {
                channelId: job.channelId,
                senderActorId: auth.actorId,
                content: job.message.content || "",
                type: job.message.type,
                ...(job.message.payload === null ? {} : { payload: job.message.payload as Prisma.InputJsonValue }),
                ...(job.message.fileName ? { fileName: job.message.fileName } : {}),
                ...(job.filePath ? { filePath: job.filePath } : {}),
                ...(typeof job.message.fileSize === "number" ? { fileSize: job.message.fileSize } : {})
              }
            })
          )
        );
        for (const message of created) {
          await emitMessage(message.id).catch((error) => request.log.warn({ error, messageId: message.id }, "forwarded message emit failed"));
          void sendMessagePush(message.id, pushOrigin).catch((error) => request.log.warn({ error, messageId: message.id }, "forwarded message push failed"));
        }
        forwarded = created.length;
      } else {
        const sourceChannel = await prisma.channel.findUnique({
          where: { id: sourceChannelId },
          select: {
            kind: true,
            name: true,
            directKey: true,
            members: { select: { account: { select: { displayName: true } } } }
          }
        });
        const memberNames = sourceChannel?.members.map((member) => member.account.displayName).filter(Boolean) ?? [];
        const title =
          sourceChannel?.kind === "direct" && memberNames.length >= 2
            ? `${memberNames[0]}和${memberNames[1]}的聊天记录`
            : `${sourceChannel?.name || "群聊"}的聊天记录`;

        for (const channelId of channelIds) {
          const items: ChatRecordStoredItem[] = [];
          let truncated = false;
          let payloadBytes = 64;
          for (const message of ordered) {
            let storedFile: string | undefined;
            if (message.filePath) {
              storedFile = copyFileName(message.filePath, message.fileName);
              await fs.promises.copyFile(path.join(uploadDir, path.basename(message.filePath)), path.join(uploadDir, storedFile));
              copiedFiles.push(storedFile);
            }
            const item = recordItemFromMessage(message, storedFile);
            payloadBytes += Buffer.byteLength(JSON.stringify(item));
            if (payloadBytes > RECORD_PAYLOAD_BYTE_LIMIT) {
              if (storedFile) {
                fs.unlinkSync(path.join(uploadDir, storedFile));
                copiedFiles.splice(copiedFiles.indexOf(storedFile), 1);
              }
              truncated = true;
              break;
            }
            items.push(item);
          }
          if (items.length < ordered.length) truncated = true;
          const payload: ChatRecordPayloadDTO = {
            kind: "chat_record",
            title,
            sourceChannelId,
            itemCount: items.length,
            ...(truncated ? { truncated: true } : {}),
            items
          };
          const record = await prisma.message.create({
            data: {
              channelId,
              senderActorId: auth.actorId,
              content: `[聊天记录] ${title}`,
              type: "chat_record",
              payload: payload as unknown as Prisma.InputJsonValue
            }
          });
          await emitMessage(record.id).catch((error) => request.log.warn({ error, messageId: record.id }, "chat record emit failed"));
          void sendMessagePush(record.id, pushOrigin).catch((error) => request.log.warn({ error, messageId: record.id }, "chat record push failed"));
          forwarded += 1;
        }
      }
      return { success: true, forwarded, skipped };
    } catch (error) {
      for (const storedFile of copiedFiles) {
        const copiedPath = path.join(uploadDir, storedFile);
        if (fs.existsSync(copiedPath)) fs.unlinkSync(copiedPath);
      }
      request.log.error({ error, sourceChannelId }, "message forward failed");
      return reply.code(500).send({ success: false, message: "转发失败，请稍后重试" });
    }
  });
}
