import { Prisma, type PrismaClient } from "@prisma/client";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { saveGraceCard } from "./gracePersistence.js";
import { storyMediaPath } from "./storyMedia.js";
import { createMessageSendIdempotency, messageSendRequestHash } from "./messageSendIdempotency.js";
import { STORY_LIMITS } from "../../shared/stories.js";
import type { GraceImage, GraceVoice } from "../../shared/types.js";

export class StoryGraceError extends Error {
  constructor(message: string, public statusCode: number) { super(message); }
}

export function storyGraceContent(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/\r\n?/g, "\n").replace(/\n/g, "<br />");
}

export interface StoryGraceInput {
  accountId: number;
  actorId: number;
  storyId: number;
  channelId: number;
  clientRequestId: string;
}

export function createStoryGraceService(prisma: PrismaClient, directories: { stories: string; uploads: string }) {
  const idempotency = createMessageSendIdempotency({
    find: (actorId, clientRequestId) => prisma.message.findUnique({
      where: { senderActorId_clientRequestId: { senderActorId: actorId, clientRequestId } },
      select: { id: true, clientRequestHash: true }
    }),
    isUniqueConflict: (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  });

  async function forward(input: StoryGraceInput) {
    const hash = messageSendRequestHash({ channelId: input.channelId, content: "", type: "grace", payload: { sourceStoryId: input.storyId }, replyToId: null });
    const result = await idempotency.send({ actorId: input.actorId, clientRequestId: input.clientRequestId, hash, create: async () => {
      const story = await prisma.story.findFirst({
        where: { id: input.storyId, accountId: input.accountId },
        include: { media: { orderBy: { position: "asc" } } }
      });
      if (!story) throw new StoryGraceError("故事不存在或无权转发", 404);
      if ((!story.text.trim() && !story.media.length) || story.media.filter((item) => item.kind === "image").length > STORY_LIMITS.images
        || story.media.filter((item) => item.kind === "voice").length > STORY_LIMITS.voices) throw new StoryGraceError("故事内容无法转发", 400);
      const copied: string[] = [];
      let committed = false;
      try {
        const images: GraceImage[] = [];
        let nativeVoice: GraceVoice | null = null;
        await fs.mkdir(directories.uploads, { recursive: true });
        for (const media of story.media) {
          const fileName = `${crypto.randomUUID()}.${media.kind === "image" ? "webp" : "m4a"}`;
          const target = path.join(directories.uploads, fileName);
          // Reserve an owned target before copying, so cleanup never removes an
          // existing upload even if a generated filename collides.
          const handle = await fs.open(target, "wx");
          copied.push(target);
          await handle.close();
          await fs.copyFile(storyMediaPath(directories.stories, media.fileName), target);
          if (media.kind === "image") images.push({ fileName, width: media.width, height: media.height });
          else nativeVoice = { fileName, durationMs: media.durationMs, mimeType: "audio/mp4" };
        }
        const saved = await saveGraceCard(prisma, directories, {
          channelId: input.channelId, actorId: input.actorId, content: storyGraceContent(story.text),
          clientRequestId: input.clientRequestId, clientRequestHash: hash,
          payload: { kind: "grace", sourceStoryId: story.id, images: images.map((image) => ({ ...image })), ...(nativeVoice ? { nativeVoice: { ...nativeVoice } } : {}) }
        });
        committed = true;
        return { id: saved.message.id, clientRequestHash: hash };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new StoryGraceError("故事附件已不可用，请刷新后重试", 409);
        throw error;
      } finally {
        if (!committed) await Promise.all(copied.map((file) => fs.rm(file, { force: true })));
      }
    } });
    if (result.state === "conflict") throw new StoryGraceError("这次转发的目标或故事已改变，请重新发起转发", 409);
    return result;
  }
  return { forward };
}
