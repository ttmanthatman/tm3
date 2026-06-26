import type { PrismaClient } from "@prisma/client";
import type { MemoryType } from "./types.js";
import { MEMORY_TYPES } from "./types.js";

export function createMemory(prisma: PrismaClient) {

  async function writeMemory(characterId: number, type: MemoryType, subjectId: string, content: string, extra?: Record<string, unknown>) {
    return prisma.characterMemory.create({
      data: {
        characterId,
        subjectType: type,
        subjectId,
        content,
        confidence: 1,
      },
    });
  }

  async function upsertMemory(characterId: number, type: MemoryType, subjectId: string, content: string) {
    const existing = await prisma.characterMemory.findFirst({
      where: { characterId, subjectType: type, subjectId },
    });
    if (existing) {
      return prisma.characterMemory.update({
        where: { id: existing.id },
        data: { content },
      });
    }
    return prisma.characterMemory.create({
      data: { characterId, subjectType: type, subjectId, content, confidence: 1 },
    });
  }

  async function getMemory(characterId: number, type: MemoryType, subjectId: string): Promise<string | null> {
    const row = await prisma.characterMemory.findFirst({
      where: { characterId, subjectType: type, subjectId },
      orderBy: { updatedAt: "desc" },
    });
    return row?.content ?? null;
  }

  async function listMemories(characterId: number, type: MemoryType, limit = 20): Promise<{ subjectId: string; content: string; updatedAt: Date }[]> {
    const rows = await prisma.characterMemory.findMany({
      where: { characterId, subjectType: type },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });
    return rows.map((r) => ({ subjectId: r.subjectId, content: r.content, updatedAt: r.updatedAt }));
  }

  async function deleteOldMemories(characterId: number, type: MemoryType, keepCount: number) {
    const rows = await prisma.characterMemory.findMany({
      where: { characterId, subjectType: type },
      orderBy: { updatedAt: "desc" },
      take: keepCount,
      select: { id: true },
    });
    const keepIds = rows.map((r) => r.id);
    await prisma.characterMemory.deleteMany({
      where: {
        characterId,
        subjectType: type,
        id: { notIn: keepIds },
      },
    });
  }

  async function recall(characterId: number, topicKeywords: string[], inStageActorIds: number[]): Promise<{
    longTerm: string[];
    midTerm: string[];
    impressions: Map<number, string>;
    emotion: string | null;
  }> {
    const [longRows, midRows, impressionRows, emotionRow] = await Promise.all([
      prisma.characterMemory.findMany({
        where: { characterId, subjectType: MEMORY_TYPES.LONG },
        orderBy: { updatedAt: "desc" },
        take: 5,
      }),
      prisma.characterMemory.findMany({
        where: { characterId, subjectType: MEMORY_TYPES.MID },
        orderBy: { updatedAt: "desc" },
        take: 5,
      }),
      prisma.characterMemory.findMany({
        where: {
          characterId,
          subjectType: MEMORY_TYPES.IMPRESSION,
          subjectId: { in: inStageActorIds.map(String) },
        },
      }),
      prisma.characterMemory.findFirst({
        where: { characterId, subjectType: MEMORY_TYPES.EMOTION, subjectId: "self" },
        orderBy: { updatedAt: "desc" },
      }),
    ]);

    let filteredMid = midRows;
    if (topicKeywords.length > 0) {
      filteredMid = midRows.filter((r) =>
        topicKeywords.some((kw) => r.content.includes(kw))
      );
      if (filteredMid.length === 0) filteredMid = midRows.slice(0, 3);
    }

    const impressions = new Map<number, string>();
    for (const row of impressionRows) {
      const actorId = Number(row.subjectId);
      if (!Number.isNaN(actorId)) impressions.set(actorId, row.content);
    }

    return {
      longTerm: longRows.map((r) => r.content),
      midTerm: filteredMid.map((r) => r.content),
      impressions,
      emotion: emotionRow?.content ?? null,
    };
  }

  async function appendShortTerm(characterId: number, messageActorId: number, messageActorName: string, content: string, messageId: number, turnIndex: number, wallClock: Date) {
    const subjectId = `msg_${messageId}`;
    const entry = `[第${turnIndex}轮 ${wallClock.toISOString().slice(11, 16)}] ${messageActorName}: ${content}`;
    await writeMemory(characterId, MEMORY_TYPES.SHORT, subjectId, entry);
    await deleteOldMemories(characterId, MEMORY_TYPES.SHORT, 30);
  }

  return { writeMemory, upsertMemory, getMemory, listMemories, deleteOldMemories, recall, appendShortTerm };
}

export type Memory = ReturnType<typeof createMemory>;
