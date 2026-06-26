import type { PrismaClient } from "@prisma/client";
import type { StageSnapshot, SnapshotMessage } from "./types.js";

export function createStage(prisma: PrismaClient) {

  async function latestVersion(channelId: number): Promise<number> {
    const row = await prisma.message.findFirst({
      where: { channelId },
      orderBy: { id: "desc" },
      select: { id: true },
    });
    return row?.id ?? 0;
  }

  function extractMulticharMeta(payload: unknown): { basedOnVersion?: number; turnIndex?: number } {
    if (!payload || typeof payload !== "object") return {};
    const p = payload as Record<string, unknown>;
    const mc = p.multichar;
    if (!mc || typeof mc !== "object") return {};
    return mc as { basedOnVersion?: number; turnIndex?: number };
  }

  async function getSnapshot(channelId: number, readFromVersion: number, limit = 30): Promise<StageSnapshot> {
    const rows = await prisma.message.findMany({
      where: {
        channelId,
        id: { lte: readFromVersion },
        type: { in: ["text", "chain"] },
      },
      orderBy: { id: "desc" },
      take: limit,
      include: { sender: true },
    });

    const messages: SnapshotMessage[] = rows.reverse().map((row) => {
      const meta = extractMulticharMeta(row.payload);
      return {
        id: row.id,
        version: row.id,
        speakerActorId: row.senderActorId,
        speakerName: row.sender?.displayName ?? "?",
        content: row.content ?? "",
        turnIndex: meta.turnIndex ?? 0,
        wallClock: row.createdAt,
        basedOnVersion: meta.basedOnVersion ?? null,
      };
    });

    return { channelId, readFromVersion, messages };
  }

  async function append(
    deps: {
      createMessageFromActor: (input: {
        channelId: number;
        actorId: number;
        content: string;
        type?: string;
        payload?: unknown;
        skipEngineEvent?: boolean;
        skipPush?: boolean;
      }) => Promise<{ id: number }>;
    },
    channelId: number,
    speakerActorId: number,
    content: string,
    basedOnVersion: number,
    turnIndex: number,
    extraMeta?: Record<string, unknown>
  ): Promise<{ messageId: number; version: number }> {
    const payload = {
      multichar: {
        basedOnVersion,
        turnIndex,
        ...extraMeta,
      },
    } as any;
    const msg = await deps.createMessageFromActor({
      channelId,
      actorId: speakerActorId,
      content,
      type: "text",
      payload,
      skipEngineEvent: true,
      skipPush: false,
    });
    return { messageId: msg.id, version: msg.id };
  }

  async function getRecentTurnIndex(channelId: number): Promise<number> {
    const rows = await prisma.message.findMany({
      where: {
        channelId,
        type: { in: ["text", "chain"] },
        payload: { path: ["multichar", "turnIndex"], not: null } as any,
      },
      orderBy: { id: "desc" },
      take: 1,
      select: { payload: true },
    });
    const meta = extractMulticharMeta(rows[0]?.payload);
    return meta.turnIndex ?? 0;
  }

  async function countMessagesSince(channelId: number, sinceVersion: number): Promise<number> {
    return prisma.message.count({
      where: {
        channelId,
        id: { gt: sinceVersion },
        type: { in: ["text", "chain"] },
      },
    });
  }

  return { latestVersion, getSnapshot, append, getRecentTurnIndex, countMessagesSince, extractMulticharMeta };
}

export type Stage = ReturnType<typeof createStage>;
