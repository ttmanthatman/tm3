import { ref } from "vue";
import type { MessageDTO, VoicePayload } from "@shared/types";
import { api, authHeaders } from "../../api";
import { useChatStore } from "../../store";
import { voiceTranscriptWords } from "./voiceTranscriptTiming";

// ASR capability is a deployment-wide flag: fetch it once per session and
// cache it module-wide so every voice bubble shares the same probe.
const asrCapability = ref<boolean | null>(null);
const asrTimestamps = ref(false);
let asrCapabilityRequest: Promise<boolean> | null = null;
let capabilityRevision = 0;
const transcriptBusyIds = ref<Set<number>>(new Set());
const transcriptNotice = ref("");
let noticeTimer: number | undefined;

export function voiceTranscript(message: MessageDTO): string {
  const payload = message.payload as Partial<VoicePayload> | undefined;
  return payload?.kind === "voice" ? String(payload.transcript || "") : "";
}

export function canShowTranscriptChip(capability: boolean | null, message: MessageDTO, timestamps = false): boolean {
  if (capability !== true) return false;
  const payload = message.payload as Partial<VoicePayload> | undefined;
  return payload?.kind === "voice" && (!voiceTranscript(message) || (timestamps && !voiceTranscriptWords(message).length));
}

export function invalidateAsrCapability() {
  void refreshAsrCapability();
}

function refreshAsrCapability() {
  const revision = ++capabilityRevision;
  asrCapability.value = null;
  asrTimestamps.value = false;
  asrCapabilityRequest = fetchAsrCapability().then((result) => {
    if (revision === capabilityRevision) {
      asrCapability.value = result.enabled;
      asrTimestamps.value = result.timestamps;
    }
    return result.enabled;
  });
  return asrCapabilityRequest;
}

function showTranscriptNotice(text: string) {
  transcriptNotice.value = text;
  if (typeof window === "undefined") return;
  if (noticeTimer) window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => {
    transcriptNotice.value = "";
  }, 4000);
}

async function fetchAsrCapability() {
  try {
    const result = await api<{ enabled: boolean; timestamps?: boolean }>("/api/asr/capability");
    return { enabled: !!result.enabled, timestamps: !!result.timestamps };
  } catch {
    return { enabled: false, timestamps: false };
  }
}

export function useVoiceTranscript() {
  const store = useChatStore();

  function ensureAsrCapability() {
    if (asrCapability.value !== null) return Promise.resolve(asrCapability.value);
    return asrCapabilityRequest || refreshAsrCapability();
  }

  function isTranscriptBusy(message: MessageDTO) {
    return transcriptBusyIds.value.has(message.id);
  }

  function setTranscriptBusy(message: MessageDTO, busy: boolean) {
    const next = new Set(transcriptBusyIds.value);
    if (busy) next.add(message.id);
    else next.delete(message.id);
    transcriptBusyIds.value = next;
  }

  async function transcribeVoice(message: MessageDTO) {
    if (!canShowTranscriptChip(asrCapability.value, message, asrTimestamps.value) || isTranscriptBusy(message)) return;
    setTranscriptBusy(message, true);
    try {
      // Raw fetch (not the api() wrapper) so the 409 = 未配置 ASR status is explicit.
      const response = await fetch(`/api/messages/${message.id}/transcribe`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ timestamps: asrTimestamps.value }),
        cache: "no-store"
      });
      if (response.status === 409) {
        asrCapability.value = false;
        showTranscriptNotice("未配置语音识别");
        return;
      }
      const result = (await response.json().catch(() => ({}))) as { transcript?: string; transcriptAt?: string; transcriptWords?: VoicePayload["transcriptWords"]; transcriptProvider?: VoicePayload["transcriptProvider"]; cached?: boolean; message?: string };
      if (!response.ok || typeof result.transcript !== "string") throw new Error(result.message || "识别失败，请稍后重试");
      const payload = {
        ...(message.payload as Record<string, unknown> | undefined),
        transcript: result.transcript,
        ...(result.transcriptWords ? { transcriptWords: result.transcriptWords } : {}),
        ...(result.transcriptProvider ? { transcriptProvider: result.transcriptProvider } : {}),
        transcriptAt: typeof result.transcriptAt === "string" && result.transcriptAt ? result.transcriptAt : new Date().toISOString()
      };
      store.replaceMessage({ ...message, payload });
    } catch (error) {
      showTranscriptNotice(error instanceof Error && error.message ? error.message : "识别失败，请稍后重试");
    } finally {
      setTranscriptBusy(message, false);
    }
  }

  return {
    asrCapability,
    asrTimestamps,
    transcriptBusyIds,
    transcriptNotice,
    ensureAsrCapability,
    isTranscriptBusy,
    transcribeVoice
  };
}
