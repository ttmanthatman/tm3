import assert from "node:assert/strict";
import test from "node:test";
import type { AiSettingsStore } from "./aiSettings.js";
import { createVoiceAsrService } from "./voiceAsr.js";

test("switching providers selects independent credentials; a running request keeps its configuration", async () => {
  let provider: "mimo" | "paraformer" = "mimo";
  const store = {
    loadAiSettings: async () => ({ value: { asr: { enabled: true, apiKeyConfigured: true, provider,
      baseUrl: "https://mimo.test/v1", model: "mimo-v2.5-asr", language: "auto",
      paraformer: { apiKeyConfigured: true, baseUrl: "wss://dashscope.aliyuncs.com/api-ws/v1/inference", model: "paraformer-realtime-v2", language: "zh" } } },
      encryptedAsrApiKey: "mimo-key", encryptedParaformerApiKey: "paraformer-key" }),
    decryptAiApiKey: (value: string) => value
  } as unknown as AiSettingsStore;
  const service = createVoiceAsrService({ aiSettings: store,
    fetchImpl: async (_url, init) => {
      assert.equal((init?.headers as Record<string, string>)["api-key"], "mimo-key");
      return new Response(JSON.stringify({ choices: [{ message: { content: "原来文字" } }] }), { status: 200 });
    },
    paraformerTranscribe: async (_audio, config) => {
      assert.equal(config.apiKey, "paraformer-key");
      assert.equal(config.settings.language, "zh");
      return { transcript: "字幕", transcriptWords: [{ text: "字幕", beginMs: 10, endMs: 200 }] };
    }
  });
  const mimo = await service.loadAsrConfig();
  assert.ok(mimo);
  provider = "paraformer";
  assert.deepEqual(await service.transcribeWavDataUrl("audio", mimo), { transcript: "原来文字", transcriptProvider: "mimo" });
  const paraformer = await service.loadAsrConfig();
  assert.ok(paraformer);
  assert.equal((await service.transcribeWavDataUrl("audio", paraformer)).transcriptProvider, "paraformer");
  provider = "mimo";
  assert.equal((await service.loadAsrConfig())?.apiKey, "mimo-key");
});
