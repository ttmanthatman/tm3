import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_VIRTUAL_CHARACTER_SYSTEM_PROMPT } from "../../shared/virtualCharacters.js";
import { createCharacterEngine } from "./engine.js";
import type { MulticharDeps, StageSnapshot } from "./types.js";
import type { Stage } from "./stage.js";
import type { Memory } from "./memory.js";
import type { AiClient } from "./ai.js";
import type { UrgeEvaluator } from "./urge.js";
import type { ImpressionManager } from "./impression.js";
import type { EmotionManager } from "./emotion.js";

test("character utterances use saved base prompts and preserve runtime persona, memory and model settings", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  for (const systemPrompt of [undefined, "管理员修改后的发言规则"]) {
    const calls: Array<{ system: string; user: string; model?: string; thinkingEnabled?: boolean }> = [];
    const snapshot: StageSnapshot = { channelId: 5, readFromVersion: 1, messages: [] };
    const engine = createCharacterEngine(
      { prisma: { virtualCharacter: { findMany: async () => [] } }, log: () => {} } as unknown as MulticharDeps,
      { latestVersion: async () => 1, getSnapshot: async () => snapshot } as unknown as Stage,
      { recall: async () => ({ longTerm: ["自动记忆"], midTerm: [], impressions: new Map(), emotion: "喜乐" }) } as unknown as Memory,
      { callMainModel: async (system, user, model, thinkingEnabled) => {
        calls.push({ system, user, model, thinkingEnabled });
        return "[PASS]";
      } } as AiClient,
      { evaluate: async () => ({ wantToSpeak: true, reason: "测试发言", urgency: "mid" }) } as UrgeEvaluator,
      {} as ImpressionManager,
      { getEmotion: async () => "喜乐", updateEmotion: async () => "喜乐", driftTowardBaseline: async () => "喜乐" } satisfies EmotionManager,
      {
        characterId: 3, actorId: 9, name: "角色甲",
        config: {
          systemPrompt,
          bio: { basics: { name: "角色甲", identity: "管理员的人格设定" } },
          emotionBaseline: "从容",
          manualMemory: { shortTerm: "手动近期记忆", midTerm: "手动中期记忆", longTerm: "手动长期记忆" },
          modelHints: { mainModel: "custom-model" },
          thinkingEnabled: true
        }
      }
    );
    try {
      engine.start(5);
      context.mock.timers.tick(9000);
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(calls.length, 1);
      assert.ok(calls[0].system.startsWith(systemPrompt ?? DEFAULT_VIRTUAL_CHARACTER_SYSTEM_PROMPT));
      assert.match(calls[0].system, /管理员的人格设定/);
      assert.match(calls[0].system, /手动近期记忆/);
      assert.match(calls[0].system, /手动中期记忆/);
      assert.match(calls[0].system, /手动长期记忆/);
      assert.match(calls[0].system, /自动记忆/);
      assert.match(calls[0].system, /从容/);
      assert.equal(calls[0].model, "custom-model");
      assert.equal(calls[0].thinkingEnabled, true);
    } finally { engine.stop(); }
  }
});
