import type { MulticharDeps } from "./types.js";
import { createStage } from "./stage.js";
import { createAiClient } from "./ai.js";
import { createMemory } from "./memory.js";
import { createImpressionManager } from "./impression.js";
import { createEmotionManager } from "./emotion.js";
import { createUrgeEvaluator } from "./urge.js";
import { createCharacterEngine, type CharacterEngine } from "./engine.js";

export function createMulticharManager(deps: MulticharDeps) {
  const stage = createStage(deps.prisma);
  const ai = createAiClient(deps);
  const memory = createMemory(deps.prisma);
  const impression = createImpressionManager(deps, memory, ai);
  const emotion = createEmotionManager(deps, memory, ai);
  const urgeEvaluator = createUrgeEvaluator(ai);

  const engines = new Map<number, CharacterEngine>();
  const sessionChannels = new Map<number, number>();

  function characterAllowsChannel(rawConfig: unknown, channelId: number) {
    const config = (rawConfig ?? {}) as Record<string, unknown>;
    const channels = Array.isArray(config.channels) ? config.channels.map(Number).filter(Number.isFinite) : [];
    return channels.length === 0 || channels.includes(channelId);
  }

  async function loadCharacterRuntime(characterId: number, channelId: number) {
    const vc = await deps.prisma.virtualCharacter.findUnique({
      where: { id: characterId },
      include: { actor: true },
    });
    if (!vc || !vc.enabled || vc.actor.status !== "active") return null;
    if (!characterAllowsChannel(vc.config, channelId)) return null;

    const config = {
      bio: ((vc.config as any)?.multichar?.bio) ?? null,
      emotionBaseline: ((vc.config as any)?.multichar?.emotionBaseline) ?? "平静中性",
      channels: Array.isArray((vc.config as any)?.channels) ? (vc.config as any).channels.map(Number).filter(Number.isFinite) : [],
      modelHints: ((vc.config as any)?.multichar?.modelHints) ?? undefined,
    };

    return {
      characterId: vc.id,
      actorId: vc.actorId,
      name: vc.actor.displayName,
      config,
    };
  }

  async function startSession(channelId: number, characterIds: number[]) {
    if (sessionChannels.has(channelId)) {
      await stopSession(channelId);
    }

    deps.log("info", `多角色对话启动: channel ${channelId}, characters ${characterIds.join(",")}`);

    for (const characterId of characterIds) {
      const runtime = await loadCharacterRuntime(characterId, channelId);
      if (!runtime) {
        deps.log("warn", `角色 ${characterId} 不可用，跳过`);
        continue;
      }

      const engine = createCharacterEngine(deps, stage, memory, ai, urgeEvaluator, impression, emotion, runtime);
      engine.start(channelId);
      engines.set(characterId, engine);
    }

    sessionChannels.set(channelId, channelId);

    return getSessionStatus(channelId);
  }

  async function stopSession(channelId: number) {
    for (const [charId, engine] of engines) {
      if (engine.getStatus().channelId === channelId) {
        engine.stop();
        engines.delete(charId);
      }
    }
    sessionChannels.delete(channelId);
    deps.log("info", `多角色对话停止: channel ${channelId}`);
  }

  function stopAll() {
    for (const engine of engines.values()) engine.stop();
    engines.clear();
    sessionChannels.clear();
  }

  async function getSessionStatus(channelId: number) {
    const characters: any[] = [];
    for (const engine of engines.values()) {
      const status = engine.getStatus();
      if (status.channelId === channelId) characters.push(status);
    }
    const totalMessages = await deps.prisma.message.count({
      where: {
        channelId,
        type: "text",
        payload: { path: ["multichar"], not: null } as any,
      },
    });
    return {
      channelId,
      running: characters.length > 0,
      startedAt: characters[0]?.lastUrgeAt ?? new Date().toISOString(),
      characterIds: characters.map((c) => c.characterId),
      characters,
      totalMessages,
    };
  }

  function getAllStatus() {
    return [...engines.values()].map((e) => e.getStatus());
  }

  return { startSession, stopSession, stopAll, getSessionStatus, getAllStatus };
}

export type MulticharManager = ReturnType<typeof createMulticharManager>;
