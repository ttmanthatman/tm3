import { Prisma, type PrismaClient } from "@prisma/client";
import { createGraceStory, type GraceStoryInput } from "./stories.js";
import fs from "node:fs/promises";
import path from "node:path";

export interface GraceSaveInput {
  channelId: number;
  actorId: number;
  content: string;
  payload: Prisma.InputJsonObject;
  clientRequestId?: string;
  clientRequestHash?: string;
  story?: Omit<GraceStoryInput, "graceMessageId">;
  source?: { id: number; content: string; payload: Prisma.JsonValue };
}

export class GraceConflictError extends Error {
  statusCode = 409;
  constructor() { super("这张恩典卡片已被更新，请重新打开编辑"); }
}

export async function saveGraceCard(prisma: PrismaClient, directories: { stories: string; uploads: string }, input: GraceSaveInput) {
  let storageFolder: string | undefined;
  try {
    return await prisma.$transaction(async (transaction) => {
      if (input.source) {
        // Compare the complete stored version under the database write lock. Two
        // editors cannot both replace the same revision, even on separate servers.
        const changed = await transaction.message.updateMany({
          where: { id: input.source.id, type: "grace", content: input.source.content, payload: { equals: input.source.payload === null ? Prisma.DbNull : input.source.payload as Prisma.InputJsonValue } },
          data: { content: input.content, payload: input.payload }
        });
        if (changed.count !== 1) throw new GraceConflictError();
      }
      const message = await transaction.message.create({ data: {
        channelId: input.channelId, senderActorId: input.actorId, type: "grace", content: input.content,
        clientRequestId: input.clientRequestId, clientRequestHash: input.clientRequestHash,
        payload: input.source ? { ...input.payload, sourceGraceMessageId: input.source.id } : input.payload
      } });
      const story = input.story ? await createGraceStory(transaction, directories, { ...input.story, graceMessageId: message.id }) : null;
      if (story?.created && "storageFolder" in story && typeof story.storageFolder === "string") storageFolder = story.storageFolder;
      return { message, story };
    }, { maxWait: 10_000, timeout: 180_000 });
  } catch (error) {
    if (storageFolder) await fs.rm(path.join(directories.stories, storageFolder), { recursive: true, force: true });
    throw error;
  }
}
