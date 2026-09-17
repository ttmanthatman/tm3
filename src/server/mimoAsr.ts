import type { AsrSettingsDTO } from "../shared/types.js";
import type { AiSettingsStore } from "./aiSettings.js";

export type MimoAsrConfig = {
  settings: AsrSettingsDTO;
  apiKey: string;
};

export type MimoAsrService = {
  loadAsrConfig(): Promise<MimoAsrConfig | null>;
  transcribeWavDataUrl(audioDataUrl: string): Promise<string>;
};

type MimoChatCompletionResponse = {
  error?: { message?: unknown };
  message?: unknown;
  choices?: Array<{ message?: { content?: unknown } }>;
};

// MiMo-V2.5-ASR 是 OpenAI 兼容的 chat/completions 接口，鉴权头是 `api-key`
// 而不是 Bearer；音频以 base64 data URL 放在 input_audio 里，只支持 mp3/wav。
export function createMimoAsrService(deps: { aiSettings: AiSettingsStore; fetchImpl?: typeof fetch }): MimoAsrService {
  const { aiSettings } = deps;
  const fetchImpl = deps.fetchImpl || fetch;

  async function loadAsrConfig(): Promise<MimoAsrConfig | null> {
    const loaded = await aiSettings.loadAiSettings();
    const settings = loaded.value.asr;
    if (!settings) return null;
    const apiKey = aiSettings.decryptAiApiKey(loaded.encryptedAsrApiKey);
    if (!settings.enabled || !apiKey) return null;
    return { settings, apiKey };
  }

  async function transcribeWavDataUrl(audioDataUrl: string): Promise<string> {
    const config = await loadAsrConfig();
    if (!config) throw new Error("MiMo ASR is not configured");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetchImpl(`${config.settings.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": config.apiKey
        },
        body: JSON.stringify({
          model: config.settings.model,
          messages: [
            {
              role: "user",
              content: [{ type: "input_audio", input_audio: { data: audioDataUrl } }]
            }
          ],
          asr_options: { language: config.settings.language },
          stream: false
        }),
        signal: controller.signal
      });
      const payload = (await response.json().catch(() => ({}))) as MimoChatCompletionResponse;
      if (!response.ok) {
        const detail = String(payload?.error?.message || payload?.message || "").slice(0, 200);
        throw new Error(`MiMo ASR HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
      }
      const transcript = String(payload?.choices?.[0]?.message?.content || "").trim();
      if (!transcript) throw new Error("MiMo ASR returned empty content");
      return transcript;
    } finally {
      clearTimeout(timeout);
    }
  }

  return { loadAsrConfig, transcribeWavDataUrl };
}
