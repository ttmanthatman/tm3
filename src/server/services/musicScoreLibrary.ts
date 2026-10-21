import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Prisma, type MusicScorePage, type PrismaClient } from "@prisma/client";
import type { MusicScoreDTO, MusicScoreLibraryEntryDTO } from "../../shared/types.js";
import { canManageMusicRole, musicTrackTitle } from "../music.js";
import { canReadMusicScore } from "../musicScoreAccess.js";
import { createMessageSendIdempotency, messageSendRequestHash } from "./messageSendIdempotency.js";

export const musicScoreLibraryInclude = {
  pages: { orderBy: { pageIndex: "asc" as const } },
  track: { select: { type: true, channelId: true, fileName: true, channel: { select: { kind: true } } } }
} satisfies Prisma.MusicScoreInclude;

export type MusicScoreLibraryRow = Prisma.MusicScoreGetPayload<{ include: typeof musicScoreLibraryInclude }>;
type ScoreReadAuth = { accountId: number; isAdmin: boolean; canPinMessages: boolean };
type ReadableScore = Pick<MusicScoreLibraryRow, "uploadedByAccountId" | "track">;

/** The page download, library metadata and sharing all apply the same source authorization. */
export async function musicScoreReadStatus(
  auth: ScoreReadAuth,
  score: ReadableScore,
  canAccessChannel: (accountId: number, channelId: number) => Promise<boolean>,
  isAudioFileName: (name?: string | null) => boolean
): Promise<200 | 403 | 404> {
  if (score.track) {
    if (score.track.type !== "file" || !isAudioFileName(score.track.fileName)) return 404;
    const canAccess = score.track.channel.kind === "music" || await canAccessChannel(auth.accountId, score.track.channelId);
    return canReadMusicScore(score.track.channel.kind, canAccess) ? 200 : 403;
  }
  return score.uploadedByAccountId === auth.accountId || canManageMusicRole(auth) ? 200 : 403;
}

export function serializeMusicScore(score: { id: number; title: string; pages: MusicScorePage[] }): MusicScoreDTO {
  return {
    id: score.id,
    title: score.title,
    kind: score.pages[0]?.fileName?.toLowerCase().endsWith(".pdf") ? "pdf" : "image",
    pages: score.pages.map((page) => ({
      id: page.id, scoreId: score.id, pageIndex: page.pageIndex, fileName: page.fileName,
      fileSize: page.fileSize, width: page.width, height: page.height
    }))
  };
}

export function serializeMusicScoreLibraryEntry(score: MusicScoreLibraryRow): MusicScoreLibraryEntryDTO {
  return { ...serializeMusicScore(score), trackId: score.trackId, trackTitle: score.track ? musicTrackTitle(score.track.fileName) : "" };
}

export class MusicScoreShareError extends Error {
  constructor(message: string, public statusCode: number) { super(message); }
}

export function createMusicScoreShareService(prisma: PrismaClient, directories: { scores: string; uploads: string }) {
  const idempotency = createMessageSendIdempotency({
    find: (actorId, clientRequestId) => prisma.message.findUnique({
      where: { senderActorId_clientRequestId: { senderActorId: actorId, clientRequestId } },
      select: { id: true, clientRequestHash: true }
    }),
    isUniqueConflict: (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  });

  async function share(input: {
    score: MusicScoreLibraryRow;
    actorId: number;
    channelId: number;
    clientRequestId: string;
    reply?: { messageId: number; aiRole: string; activationMode: string; anchorMessageId: number };
  }) {
    const { score, actorId, channelId, clientRequestId, reply } = input;
    const replyPayload = reply ? {
      aiRole: reply.aiRole,
      triggerMessageId: reply.messageId,
      aiActivationMode: reply.activationMode,
      activationAnchorMessageId: reply.anchorMessageId
    } : {};
    const hash = messageSendRequestHash({
      channelId, content: "", type: "music_score_share",
      payload: { scoreId: score.id, ...replyPayload }, replyToId: reply?.messageId ?? null
    });
    const result = await idempotency.send({ actorId, clientRequestId, hash, create: async () => {
      if (!score.pages.length) throw new MusicScoreShareError("歌谱没有可分享的页面", 400);
      const copied: string[] = [];
      let committed = false;
      try {
        await fs.mkdir(directories.uploads, { recursive: true });
        const files: { page: MusicScorePage; filePath: string; fileSize: number; type: "image" | "file" }[] = [];
        for (const page of score.pages) {
          const extension = path.extname(page.filePath).toLowerCase();
          const filePath = `${crypto.randomUUID()}${extension}`;
          const target = path.join(directories.uploads, filePath);
          // Reserve only our own path, so a filename collision cannot overwrite or clean up another upload.
          const handle = await fs.open(target, "wx");
          copied.push(target);
          await handle.close();
          await fs.copyFile(path.join(directories.scores, path.basename(page.filePath)), target);
          const stat = await fs.stat(target);
          files.push({ page, filePath, fileSize: stat.size, type: page.fileName.toLowerCase().endsWith(".pdf") ? "file" : "image" });
        }
        const first = await prisma.$transaction(async (transaction) => {
          let firstMessage: { id: number; clientRequestHash: string | null } | null = null;
          for (const [index, file] of files.entries()) {
            const created = await transaction.message.create({ data: {
              channelId, senderActorId: actorId,
              clientRequestId: index === 0 ? clientRequestId : `${clientRequestId}:score:${index}`,
              clientRequestHash: hash,
              ...(reply ? { replyToId: reply.messageId } : {}),
              content: score.title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"),
              type: file.type,
              fileName: file.page.fileName,
              filePath: file.filePath,
              fileSize: file.fileSize,
              payload: {
                sourceMusicScoreId: score.id, musicScoreShareRequestId: clientRequestId, musicScorePageIndex: index,
                ...replyPayload,
                ...(file.type === "image" ? { imageWidth: file.page.width, imageHeight: file.page.height } : {})
              }
            } });
            firstMessage ??= created;
          }
          return firstMessage!;
        });
        committed = true;
        return first;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new MusicScoreShareError("歌谱文件不存在，请刷新后重试", 404);
        throw error;
      } finally {
        if (!committed) await Promise.all(copied.map((file) => fs.rm(file, { force: true })));
      }
    } });
    if (result.state === "conflict") throw new MusicScoreShareError("这次分享的歌谱或目标已改变，请重新发起分享", 409);
    const messages = await prisma.message.findMany({
      where: { senderActorId: actorId, channelId, OR: [{ clientRequestId }, { clientRequestId: { startsWith: `${clientRequestId}:score:` } }] },
      orderBy: { id: "asc" }, select: { id: true }
    });
    return { state: result.state, messageIds: messages.map((message) => message.id) };
  }
  return { share };
}
