import { Prisma, type AccountRole, type PrismaClient } from "@prisma/client";
import type { StoryAuthorDTO, StoryDTO, StoryInteractionsDTO, StoryPersonDTO } from "../../shared/stories.js";
import fs from "node:fs/promises";
import { storyMediaPath } from "./storyMedia.js";
import { STORY_DEFAULT_BIO } from "../../shared/stories.js";

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
  comments: { include: { account: { select: interactionAccountSelect } }, orderBy: { id: "asc" } }
});

export type StoryRow = Prisma.StoryGetPayload<{ include: typeof storyInclude }>;

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
      text: comment.text,
      createdAt: comment.createdAt.toISOString(),
      canDelete: comment.accountId === viewerAccountId || story.accountId === viewerAccountId || viewerRole === "admin"
    }))
  };
}

export function createStoryService(prisma: PrismaClient) {
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

  return { authorFor, accessFor, viewerRole };
}

export function storyDto(story: StoryRow, viewerAccountId: number, viewerRole: AccountRole): StoryDTO {
  return { id: story.id, text: story.text, createdAt: story.createdAt.toISOString(), media: story.media.map((media) => ({
    id: media.id, kind: media.kind === "voice" ? "voice" : "image", width: media.width, height: media.height, durationMs: media.durationMs
  })), interactions: storyInteractionsDto(story, viewerAccountId, viewerRole) };
}
