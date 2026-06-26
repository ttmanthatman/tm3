import type { PrismaClient } from "@prisma/client";
import type { MulticharDeps } from "./types.js";
import type { AiClient } from "./ai.js";
import { MEMORY_TYPES } from "./types.js";
import type { Memory } from "./memory.js";

export function createImpressionManager(deps: MulticharDeps, memory: Memory, ai: AiClient) {

  async function getImpression(subjectCharacterId: number, objectActorId: number): Promise<string> {
    const existing = await memory.getMemory(subjectCharacterId, MEMORY_TYPES.IMPRESSION, String(objectActorId));
    return existing ?? "";
  }

  async function updateImpression(
    listenerCharacterId: number,
    listenerName: string,
    speakerActorId: number,
    speakerName: string,
    speakerContent: string,
    model?: string
  ): Promise<{ changed: boolean; newImpression: string }> {
    const current = await getImpression(listenerCharacterId, speakerActorId);

    const systemPrompt = `你是 ${listenerName}。你正在观察一场对话，${speakerName} 刚说了一段话。
结合你之前对他的印象（如果有），判断这次发言是否让你对他的看法有变化。
- 有变化：改写你的印象段落。保留演化痕迹（"一开始觉得...后来..."），不要完全推翻历史判断。
- 没变化：原样返回之前的印象。
只输出印象段落本身，不要加任何前缀或解释。如果没有之前的印象，就从这次发言开始形成初步印象。`;

    const userPrompt = `你之前对 ${speakerName} 的印象：
${current || "（暂无印象）"}

${speakerName} 刚说的：
${speakerContent}`;

    try {
      const result = await ai.callImpressionModel(systemPrompt, userPrompt, model);
      const trimmed = result.trim();
      if (!trimmed || trimmed === current) {
        return { changed: false, newImpression: current };
      }
      await memory.upsertMemory(listenerCharacterId, MEMORY_TYPES.IMPRESSION, String(speakerActorId), trimmed);
      return { changed: true, newImpression: trimmed };
    } catch (err) {
      deps.log("warn", `印象更新失败: ${listenerName} -> ${speakerName}`, err);
      return { changed: false, newImpression: current };
    }
  }

  async function updateForSpeaker(
    speakerCharacterId: number,
    speakerActorId: number,
    speakerName: string,
    speakerContent: string,
    listenerCharacterIds: number[],
    listenerNames: Map<number, string>,
    model?: string
  ) {
    const tasks = listenerCharacterIds
      .filter((id) => id !== speakerCharacterId)
      .map((id) =>
        updateImpression(id, listenerNames.get(id) ?? "?", speakerActorId, speakerName, speakerContent, model)
          .catch(() => ({ changed: false, newImpression: "" }))
      );
    await Promise.all(tasks);
  }

  return { getImpression, updateImpression, updateForSpeaker };
}

export type ImpressionManager = ReturnType<typeof createImpressionManager>;
