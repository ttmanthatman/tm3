import assert from "node:assert/strict";
import test from "node:test";
import type { AiSettingsStore } from "./aiSettings.js";
import { createMimoAsrService } from "./mimoAsr.js";

function fakeStore(options: { enabled?: boolean; apiKey?: string; language?: "auto" | "zh" | "en" } = {}) {
  const encrypted = options.apiKey ? `enc:${options.apiKey}` : "";
  return {
    loadAiSettings: async () => ({
      value: {
        asr: {
          enabled: options.enabled ?? true,
          apiKeyConfigured: !!options.apiKey,
          baseUrl: "https://asr.test/v1/",
          model: "mimo-v2.5-asr",
          language: options.language || "auto"
        }
      },
      encryptedApiKey: "",
      encryptedAsrApiKey: encrypted,
      loadedAt: 0
    }),
    decryptAiApiKey: (value: string) => (value.startsWith("enc:") ? value.slice(4) : ""),
    encryptAiApiKey: (value: string) => `enc:${value}`,
    resetAiSettingsCache: () => {}
  } as unknown as AiSettingsStore;
}

type CapturedRequest = { url: string; init: RequestInit };

function fetchReturning(response: Response, captured: CapturedRequest[]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    captured.push({ url: String(url), init: init || {} });
    return response;
  }) as typeof fetch;
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("transcribeWavDataUrl posts input_audio to the MiMo endpoint and returns the transcript", async () => {
  const captured: CapturedRequest[] = [];
  const service = createMimoAsrService({
    aiSettings: fakeStore({ apiKey: "sk-fake-test-key", language: "zh" }),
    fetchImpl: fetchReturning(jsonResponse(200, { choices: [{ message: { content: "  识别出的文字  " } }] }), captured)
  });
  const transcript = await service.transcribeWavDataUrl("data:audio/wav;base64,QUJD");
  assert.equal(transcript, "识别出的文字");
  assert.equal(captured.length, 1);
  assert.equal(captured[0].url, "https://asr.test/v1/chat/completions");
  const headers = captured[0].init.headers as Record<string, string>;
  assert.equal(headers["api-key"], "sk-fake-test-key");
  const body = JSON.parse(String(captured[0].init.body));
  assert.equal(body.model, "mimo-v2.5-asr");
  assert.equal(body.messages[0].content[0].type, "input_audio");
  assert.equal(body.messages[0].content[0].input_audio.data, "data:audio/wav;base64,QUJD");
  assert.deepEqual(body.asr_options, { language: "zh" });
});

test("loadAsrConfig returns null when ASR is disabled or the key is missing", async () => {
  const disabled = createMimoAsrService({ aiSettings: fakeStore({ apiKey: "sk-x", enabled: false }) });
  assert.equal(await disabled.loadAsrConfig(), null);
  const noKey = createMimoAsrService({ aiSettings: fakeStore({ enabled: true }) });
  assert.equal(await noKey.loadAsrConfig(), null);
  await assert.rejects(() => noKey.transcribeWavDataUrl("data:audio/wav;base64,QUJD"), /not configured/);
});

test("non-2xx responses throw with the status code and upstream detail", async () => {
  const service = createMimoAsrService({
    aiSettings: fakeStore({ apiKey: "sk-x" }),
    fetchImpl: fetchReturning(jsonResponse(401, { error: { message: "invalid api key" } }), [])
  });
  await assert.rejects(() => service.transcribeWavDataUrl("data:audio/wav;base64,QUJD"), /MiMo ASR HTTP 401: invalid api key/);
});

test("empty content throws", async () => {
  const service = createMimoAsrService({
    aiSettings: fakeStore({ apiKey: "sk-x" }),
    fetchImpl: fetchReturning(jsonResponse(200, { choices: [{ message: { content: "   " } }] }), [])
  });
  await assert.rejects(() => service.transcribeWavDataUrl("data:audio/wav;base64,QUJD"), /empty content/);
});
