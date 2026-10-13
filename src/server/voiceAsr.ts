import type { VoiceTranscriptWord } from "../shared/types.js";
import type { AiSettingsStore } from "./aiSettings.js";
import { createMimoAsrService, type MimoAsrConfig } from "./mimoAsr.js";
import { transcribeParaformerWav } from "./paraformerAsr.js";

export type VoiceAsrConfig = MimoAsrConfig & { provider: "mimo" | "paraformer" };
export type VoiceTranscription = { transcript: string; transcriptWords?: VoiceTranscriptWord[]; transcriptProvider: "mimo" | "paraformer" };
export type VoiceAsrService = {
  loadAsrConfig(): Promise<VoiceAsrConfig | null>;
  transcribeWavDataUrl(audio: string, config: VoiceAsrConfig): Promise<VoiceTranscription>;
};

export function createVoiceAsrService(deps: { aiSettings: AiSettingsStore; fetchImpl?: typeof fetch; paraformerTranscribe?: typeof transcribeParaformerWav }): VoiceAsrService {
  const mimo = createMimoAsrService(deps);
  return {
    async loadAsrConfig() {
      const loaded = await deps.aiSettings.loadAiSettings();
      const asr = loaded.value.asr;
      if (!asr?.enabled) return null;
      const provider = asr.provider || "mimo";
      const settings = provider === "paraformer" ? asr.paraformer : asr;
      const apiKey = deps.aiSettings.decryptAiApiKey(provider === "paraformer" ? loaded.encryptedParaformerApiKey : loaded.encryptedAsrApiKey);
      if (!settings || !apiKey) return null;
      return { provider, apiKey, settings: { ...settings, enabled: asr.enabled } };
    },
    async transcribeWavDataUrl(audio, config) {
      if (config.provider === "paraformer") return { ...await (deps.paraformerTranscribe || transcribeParaformerWav)(audio, config), transcriptProvider: "paraformer" };
      return { transcript: await mimo.transcribeWavDataUrl(audio, config), transcriptProvider: "mimo" };
    }
  };
}
