import { Prisma, type AccountRole, type PrismaClient } from "@prisma/client";
import type { StoryAuthorDTO, StoryDTO, StoryFeedItemDTO, StoryInteractionsDTO, StoryPersonDTO } from "../../shared/stories.js";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { prepareStoryMedia, storyMediaPath, StoryInputError, type StoredStoryMedia } from "./storyMedia.js";
import { STORY_DEFAULT_BIO, STORY_LIMITS, validStoryMedia } from "../../shared/stories.js";
import { plainTextFromHtml } from "../textUtils.js";

export type GraceStoryInput = {
  accountId: number;
  graceMessageId: number;
  content: string;
  imageMessageId?: number;
  voiceMessageId?: number;
};

export async function createGraceStory(
  prisma: PrismaClient,
  directories: { stories: string; uploads: string },
  input: GraceStoryInput
) {
  const requestId = `grace:${input.graceMessageId}`;
  const existing = await prisma.story.findUnique({
    where: { accountId_requestId: { accountId: input.accountId, requestId } },
    select: { id: true, createdAt: true }
  });
  if (existing) return { ...existing, created: false };

  const sourceIds = [input.imageMessageId, input.voiceMessageId].filter((id): id is number => !!id);
  const sources = sourceIds.length
    ? await prisma.message.findMany({
        where: { id: { in: sourceIds } },
        select: { id: true, type: true, payload: true, filePath: true }
      })
    : [];
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const orderedSources: Array<{ kind: "image" | "voice"; filePath: string }> = [];
  if (input.imageMessageId) {
    const source = sourceById.get(input.imageMessageId);
    if (!source?.filePath || source.type !== "image") throw new StoryInputError("恩典照片无法同步到故事");
    orderedSources.push({ kind: "image", filePath: source.filePath });
  }
  if (input.voiceMessageId) {
    const source = sourceById.get(input.voiceMessageId);
    const payload = source?.payload && typeof source.payload === "object" && !Array.isArray(source.payload)
      ? source.payload as Record<string, unknown>
      : {};
    if (!source?.filePath || source.type !== "file" || payload.kind !== "voice") throw new StoryInputError("恩典语音无法同步到故事");
    orderedSources.push({ kind: "voice", filePath: source.filePath });
  }

  const text = plainTextFromHtml(input.content, STORY_LIMITS.text);
  if (!text && !validStoryMedia(orderedSources.map((source) => source.kind))) {
    throw new StoryInputError("恩典内容无法同步到故事");
  }

  const folder = crypto.randomUUID();
  const targetDirectory = path.join(directories.stories, folder);
  let committed = false;
  const media: StoredStoryMedia[] = [];
  try {
    if (orderedSources.length) {
      await fs.mkdir(targetDirectory, { recursive: true });
      for (const [position, source] of orderedSources.entries()) {
        const stored = await prepareStoryMedia(
          path.join(directories.uploads, path.basename(source.filePath)),
          targetDirectory,
          source.kind,
          position
        );
        media.push({ ...stored, fileName: `${folder}/${stored.fileName}` });
      }
    }
    try {
      const story = await prisma.story.create({
        data: {
          accountId: input.accountId,
          requestId,
          text,
          ...(media.length ? { media: { create: media } } : {})
        },
        select: { id: true, createdAt: true }
      });
      committed = true;
      return { ...story, created: true };
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error;
      const concurrent = await prisma.story.findUnique({
        where: { accountId_requestId: { accountId: input.accountId, requestId } },
        select: { id: true, createdAt: true }
      });
      if (!concurrent) throw error;
      return { ...concurrent, created: false };
    }
  } finally {
    if (!committed && orderedSources.length) await fs.rm(targetDirectory, { recursive: true, force: true });
  }
}

export async function prepareAccountStoryCleanup(prisma: PrismaClient, directory: string, accountId: number) {
  const files = await prisma.storyMedia.findMany({ where: { story: { accountId } }, select: { fileName: true } });
  return async () => {
    for (const { fileName } of files) {
      const file = storyMediaPath(directory, fileName);
      await fs.rm(file, { force: true });
      await fs.rm(`${file}.thumb.webp`, { force: true });
    }
  };
}

const interactionAccountSelect = Prisma.validator<Prisma.AccountSelect>()({
  id: true,
  displayName: true,
  avatarPath: true,
  actor: { select: { id: true } }
});

export const storyInclude = Prisma.validator<Prisma.StoryInclude>()({
  media: { orderBy: { position: "asc" } },
  likes: { include: { account: { select: interactionAccountSelect } }, orderBy: { createdAt: "asc" } },
  comments: {
    include: {
      account: { select: interactionAccountSelect },
      replyTo: { include: { account: { select: interactionAccountSelect } } }
    },
    orderBy: { id: "asc" }
  }
});

export const storyFeedInclude = Prisma.validator<Prisma.StoryInclude>()({
  ...storyInclude,
  account: { select: { ...interactionAccountSelect, gender: true, storyBio: true } }
});

export type StoryRow = Prisma.StoryGetPayload<{ include: typeof storyInclude }>;
export type StoryFeedRow = Prisma.StoryGetPayload<{ include: typeof storyFeedInclude }>;

function personDto(account: StoryRow["likes"][number]["account"]): StoryPersonDTO {
  return { accountId: account.id, actorId: account.actor?.id || 0, displayName: account.displayName, avatarPath: account.avatarPath };
}

export function storyInteractionsDto(story: Pick<StoryRow, "accountId" | "likes" | "comments">, viewerAccountId: number, viewerRole: AccountRole): StoryInteractionsDTO {
  return {
    liked: story.likes.some((like) => like.accountId === viewerAccountId),
    likeCount: story.likes.length,
    likes: story.likes.map((like) => personDto(like.account)),
    commentCount: story.comments.length,
    comments: story.comments.map((comment) => ({
      id: comment.id,
      author: personDto(comment.account),
      replyTo: comment.replyTo ? { id: comment.replyTo.id, author: personDto(comment.replyTo.account) } : null,
      text: comment.text,
      createdAt: comment.createdAt.toISOString(),
      canDelete: comment.accountId === viewerAccountId || story.accountId === viewerAccountId || viewerRole === "admin"
    }))
  };
}

export function createStoryService(prisma: PrismaClient) {
  async function visibleAuthorAccountIds(viewerId: number): Promise<number[]> {
    const viewer = await prisma.account.findUnique({ where: { id: viewerId }, select: { isGuest: true } });
    if (!viewer || viewer.isGuest) return [];
    const regularAccountWhere = { isGuest: false, actor: { is: { kind: "human" as const, status: "active" as const } } };
    const publicChannel = await prisma.channel.findFirst({
      where: { kind: "standard", isPrivate: false, directKey: null },
      select: { id: true }
    });
    if (publicChannel) {
      return (await prisma.account.findMany({ where: regularAccountWhere, select: { id: true } })).map((account) => account.id);
    }
    const sharedChannels = await prisma.channel.findMany({
      where: {
        kind: { notIn: ["music", "aiLounge"] },
        AND: [
          { OR: [{ kind: { not: "reception" } }, { receptionExpiresAt: { gt: new Date() } }] },
          { members: { some: { accountId: viewerId } } }
        ]
      },
      select: { members: { select: { accountId: true } } }
    });
    const candidates = new Set<number>([viewerId]);
    for (const channel of sharedChannels) for (const member of channel.members) candidates.add(member.accountId);
    return (await prisma.account.findMany({
      where: { ...regularAccountWhere, id: { in: [...candidates] } },
      select: { id: true }
    })).map((account) => account.id);
  }

  async function authorFor(viewerId: number, actorId: number): Promise<StoryAuthorDTO | null> {
    const [viewer, actor] = await Promise.all([
      prisma.account.findUnique({ where: { id: viewerId }, select: { isGuest: true } }),
      prisma.actor.findUnique({ where: { id: actorId }, include: { account: true } })
    ]);
    const author = actor?.account;
    if (!viewer || viewer.isGuest || !author || author.isGuest || actor.kind !== "human" || actor.status !== "active") return null;
    if (viewerId !== author.id) {
      // Public standard channels already expose their member list to every
      // regular account. Restricted channels require both explicit memberships.
      const shared = await prisma.channel.findFirst({
        where: {
          kind: { notIn: ["music", "aiLounge"] },
          AND: [
            { OR: [{ kind: { not: "reception" } }, { receptionExpiresAt: { gt: new Date() } }] },
            { OR: [
              { kind: "standard", isPrivate: false, directKey: null },
              { members: { some: { accountId: viewerId } }, AND: { members: { some: { accountId: author.id } } } }
            ] }
          ]
        },
        select: { id: true }
      });
      if (!shared) return null;
    }
    return { accountId: author.id, actorId, displayName: author.displayName, avatarPath: author.avatarPath,
      gender: author.gender === "female" || author.gender === "male" ? author.gender : "unspecified", bio: author.storyBio || STORY_DEFAULT_BIO, own: viewerId === author.id };
  }

  async function accessFor(viewerId: number, storyId: number) {
    const story = await prisma.story.findUnique({
      where: { id: storyId },
      select: { id: true, accountId: true, account: { select: { actor: { select: { id: true } } } } }
    });
    const actorId = story?.account.actor?.id;
    if (!story || !actorId) return null;
    const author = await authorFor(viewerId, actorId);
    return author ? { story, author } : null;
  }

  async function viewerRole(accountId: number): Promise<AccountRole> {
    return (await prisma.account.findUnique({ where: { id: accountId }, select: { role: true } }))?.role || "user";
  }

  return { authorFor, accessFor, viewerRole, visibleAuthorAccountIds };
}

export function storyDto(story: StoryRow, viewerAccountId: number, viewerRole: AccountRole): StoryDTO {
  return { id: story.id, text: story.text, createdAt: story.createdAt.toISOString(), media: story.media.map((media) => ({
    id: media.id, kind: media.kind === "voice" ? "voice" : "image", width: media.width, height: media.height, durationMs: media.durationMs
  })), interactions: storyInteractionsDto(story, viewerAccountId, viewerRole) };
}

export function storyFeedDto(story: StoryFeedRow, viewerAccountId: number, viewerRole: AccountRole): StoryFeedItemDTO {
  return {
    ...storyDto(story, viewerAccountId, viewerRole),
    author: {
      accountId: story.account.id,
      actorId: story.account.actor?.id || 0,
      displayName: story.account.displayName,
      avatarPath: story.account.avatarPath,
      gender: story.account.gender === "female" || story.account.gender === "male" ? story.account.gender : "unspecified",
      bio: story.account.storyBio || STORY_DEFAULT_BIO,
      own: story.account.id === viewerAccountId
    }
  };
}
