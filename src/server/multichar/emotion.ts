import type { MulticharDeps } from "./types.js";
import type { AiClient } from "./ai.js";
import { MEMORY_TYPES } from "./types.js";
import type { Memory } from "./memory.js";

export function createEmotionManager(deps: MulticharDeps, memory: Memory, ai: AiClient) {

  async function getEmotion(characterId: number): Promise<string | null> {
    return memory.getMemory(characterId, MEMORY_TYPES.EMOTION, "self");
  }

  async function updateEmotion(
    characterId: number,
    characterName: string,
    emotionBaseline: string,
    triggerDescription: string,
    model?: string
  ): Promise<string> {
    const current = await getEmotion(characterId);

    const systemPrompt = `你是 ${characterName}。你的情绪基线是：${emotionBaseline}
根据刚刚发生的事，更新你当前的情绪状态描述。用自然语言写一段你的内心感受。
情绪会自然漂移——如果刚才的事让你波动，描述波动后的状态；如果没什么影响，保持或稍微回归基线。
只输出情绪描述，不要加前缀。`;

    const userPrompt = `你当前的情绪：${current || emotionBaseline}
你的情绪基线：${emotionBaseline}

刚刚发生的事：${triggerDescription}`;

    try {
      const result = await ai.callImpressionModel(systemPrompt, userPrompt, model);
      const trimmed = result.trim();
      if (trimmed) {
        await memory.upsertMemory(characterId, MEMORY_TYPES.EMOTION, "self", trimmed);
      }
      return trimmed || current || emotionBaseline;
    } catch (err) {
      deps.log("warn", `情绪更新失败: ${characterName}`, err);
      return current ?? emotionBaseline;
    }
  }

  async function driftTowardBaseline(
    characterId: number,
    characterName: string,
    emotionBaseline: string,
    model?: string
  ): Promise<string> {
    const current = await getEmotion(characterId);
    if (!current || current === emotionBaseline) return emotionBaseline;

    const systemPrompt = `你是 ${characterName}。你的情绪基线是：${emotionBaseline}
距离上次情绪事件已经过了一段时间。模拟自然情绪回归，写一段更接近基线、但可能还残留一点当前情绪的状态描述。
只输出情绪描述。`;

    const userPrompt = `你当前的情绪：${current}
你的情绪基线：${emotionBaseline}`;

    try {
      const result = await ai.callImpressionModel(systemPrompt, userPrompt, model);
      const trimmed = result.trim();
      if (trimmed) {
        await memory.upsertMemory(characterId, MEMORY_TYPES.EMOTION, "self", trimmed);
        return trimmed;
      }
    } catch (err) {
      deps.log("warn", `情绪回归失败: ${characterName}`, err);
    }
    return current;
  }

  return { getEmotion, updateEmotion, driftTowardBaseline };
}

export type EmotionManager = ReturnType<typeof createEmotionManager>;
