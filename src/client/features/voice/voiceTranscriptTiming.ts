import type { MessageDTO, VoicePayload, VoiceTranscriptWord } from "@shared/types";

export function voiceTranscriptWords(message: MessageDTO): VoiceTranscriptWord[] {
  const payload = message.payload as Partial<VoicePayload> | undefined;
  if (payload?.kind !== "voice" || !Array.isArray(payload.transcriptWords) || !payload.transcriptWords.length) return [];
  const words = payload.transcriptWords;
  if (!words.every((word) => word && typeof word.text === "string"
    && Number.isFinite(word.beginMs) && Number.isFinite(word.endMs)
    && word.beginMs >= 0 && word.endMs >= word.beginMs)) return [];
  return [...words].sort((a, b) => a.beginMs - b.beginMs);
}

export function revealedTranscriptWords(words: VoiceTranscriptWord[], elapsedMs: number): VoiceTranscriptWord[] {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return [];
  return words.filter((word) => word.beginMs <= elapsedMs);
}
