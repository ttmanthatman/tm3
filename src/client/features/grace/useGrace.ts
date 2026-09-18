import { computed, nextTick, ref } from "vue";
import type { GracePayload, MessageDTO } from "@shared/types";
import { api } from "../../api";
import { adminDate } from "../admin/adminFormat";
import { escapeHtmlText } from "../messages/messageRendering";
import { useVoiceRecording } from "../voice/useVoiceRecording";

export type GraceUploadResult = { success: boolean; duplicate: boolean; skipped: boolean; messageId?: number };
export type GraceUploadOptions = {
  voice?: boolean;
  durationMs?: number;
  waveform?: number[];
  channelId?: number;
  suppressAlert?: boolean;
};

interface UseGraceOptions {
  uploadFile: (file: File, options?: GraceUploadOptions) => Promise<GraceUploadResult>;
  currentChannelId: () => number | null;
  onSubmitted: (message: MessageDTO) => void;
  onUpdated?: (message: MessageDTO) => void;
  onDeleted?: () => void | Promise<void>;
  scrollBottom?: (smooth?: boolean) => void;
  notify: (text: string) => void;
}

export function gracePayload(message: MessageDTO): GracePayload {
  const raw = (message.payload || {}) as Partial<GracePayload>;
  return {
    kind: "grace",
    voiceMessageId: Number(raw.voiceMessageId || 0) > 0 ? Number(raw.voiceMessageId) : null,
    imageMessageId: Number(raw.imageMessageId || 0) > 0 ? Number(raw.imageMessageId) : null,
    sourceGraceMessageId: Number(raw.sourceGraceMessageId || 0) > 0 ? Number(raw.sourceGraceMessageId) : null,
    latestUpdateAt: raw.latestUpdateAt,
    latestUpdateBy: raw.latestUpdateBy,
    updates: Array.isArray(raw.updates) ? raw.updates : [],
    gratitudeCount: Number(raw.gratitudeCount || 0),
    gratitudeActionCount: Number(raw.gratitudeActionCount || 0),
    currentUserGrateful: !!raw.currentUserGrateful,
    gratefulBy: Array.isArray(raw.gratefulBy) ? raw.gratefulBy : [],
    aiSuggestions: Array.isArray(raw.aiSuggestions) ? raw.aiSuggestions : [],
    aiSuggestionSuccessCount: Number(raw.aiSuggestionSuccessCount || 0),
    aiSuggestionMaxSuccess: Number(raw.aiSuggestionMaxSuccess || 7),
    voice: raw.voice || null,
    effect: raw.effect
  };
}

// 纯语音也允许存入：文字与语音至少其一。
export function graceSubmissionReady(content: string, hasVoice: boolean): boolean {
  return !!content.trim() || hasVoice;
}

export function useGrace(options: UseGraceOptions) {
  const graceComposerOpen = ref(false);
  const graceBusy = ref(false);
  const graceError = ref("");
  const graceContent = ref("");
  const gracePhoto = ref<File | null>(null);
  const gracePhotoPreview = ref("");
  const graceTargetChannelId = ref<number | null>(null);
  const pendingGraceUpdate = ref<MessageDTO | null>(null);
  const graceUpdateContent = ref("");
  const graceUpdateBusy = ref(false);
  const graceUpdateError = ref("");
  const graceUpdatePhoto = ref<File | null>(null);
  const graceUpdatePhotoPreview = ref("");
  // The recording flow is reused from the composer; its pending-message/send
  // path stays unused here because grace voice uploads go through submitGrace.
  const graceRecordingPanel = ref<"voice" | "more" | null>(null);
  const recording = useVoiceRecording({
    composerPanel: graceRecordingPanel,
    pushPendingVoiceMessage: () => 0,
    uploadFile: (file, uploadOptions) => options.uploadFile(file, uploadOptions)
  });

  const graceCanSubmit = computed(() => graceSubmissionReady(graceContent.value, !!recording.audioFile.value));
  const graceUpdateCanPublish = computed(() => !!graceUpdateContent.value.trim());

  function graceActionText(message: MessageDTO) {
    const payload = gracePayload(message);
    if (!payload.gratitudeCount) return "还没有人为此感恩";
    const names = payload.gratefulBy.slice(0, 3).map((item) => item.displayName).join("、");
    return `${names}${payload.gratitudeCount > 3 ? ` 等 ${payload.gratitudeCount} 人` : ""} 为此感恩`;
  }

  function graceLatestTime(message: MessageDTO) {
    const latest = gracePayload(message).gratefulBy[0]?.latestGratefulAt;
    return latest ? adminDate(latest) : "";
  }

  function clearGracePhoto() {
    if (gracePhotoPreview.value) URL.revokeObjectURL(gracePhotoPreview.value);
    gracePhoto.value = null;
    gracePhotoPreview.value = "";
  }

  function handleGracePhotoPick(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    clearGracePhoto();
    gracePhoto.value = file;
    gracePhotoPreview.value = URL.createObjectURL(file);
    graceError.value = "";
  }

  function openGraceComposer(prefill = "") {
    graceTargetChannelId.value = options.currentChannelId();
    graceContent.value = prefill;
    graceError.value = "";
    graceBusy.value = false;
    clearGracePhoto();
    recording.resetRecording();
    graceComposerOpen.value = true;
  }

  function closeGraceComposer(force = false) {
    if (graceBusy.value && !force) return;
    graceComposerOpen.value = false;
    graceTargetChannelId.value = null;
    graceContent.value = "";
    graceError.value = "";
    clearGracePhoto();
    recording.resetRecording();
  }

  async function submitGrace() {
    const content = graceContent.value.trim();
    const voiceFile = recording.audioFile.value;
    const channelId = graceTargetChannelId.value;
    if (graceBusy.value) return;
    if (!graceSubmissionReady(content, !!voiceFile)) {
      graceError.value = "写下一段文字或录一段语音，再存入恩典册";
      return;
    }
    if (!channelId) {
      graceError.value = "请先进入一个频道再记录恩典";
      return;
    }
    graceBusy.value = true;
    graceError.value = "";
    try {
      let voiceMessageId: number | undefined;
      let imageMessageId: number | undefined;
      if (voiceFile) {
        const upload = await options.uploadFile(voiceFile, {
          voice: true,
          durationMs: recording.audioPreviewDurationMs.value || recording.recordingDuration.value,
          waveform: recording.audioPreviewWaveform.value,
          channelId,
          suppressAlert: true
        });
        if (!upload.success || !upload.messageId) throw new Error("语音上传失败，请重试");
        voiceMessageId = upload.messageId;
      }
      if (gracePhoto.value) {
        const upload = await options.uploadFile(gracePhoto.value, { channelId, suppressAlert: true });
        if (!upload.success || !upload.messageId) throw new Error("照片上传失败，请重试");
        imageMessageId = upload.messageId;
      }
      const result = await api<{ success: boolean; message: MessageDTO }>("/api/grace", {
        method: "POST",
        body: JSON.stringify({ channelId, content: content || undefined, voiceMessageId, imageMessageId })
      });
      if (result.message) options.onSubmitted(result.message);
      closeGraceComposer(true);
      options.notify("恩典卡片已发送");
    } catch (error) {
      graceError.value = error instanceof Error ? error.message : "存入恩典失败，请重试";
    } finally {
      graceBusy.value = false;
    }
  }

  async function markGraceGrateful(message: MessageDTO) {
    const result = await api<{ success: boolean; message: MessageDTO }>(`/api/messages/${message.id}/grateful`, {
      method: "POST",
      body: JSON.stringify({})
    });
    if (result.message) options.onUpdated?.(result.message);
  }

  function clearGraceUpdatePhoto() {
    if (graceUpdatePhotoPreview.value) URL.revokeObjectURL(graceUpdatePhotoPreview.value);
    graceUpdatePhoto.value = null;
    graceUpdatePhotoPreview.value = "";
  }

  function openGraceUpdateEditor(message: MessageDTO) {
    pendingGraceUpdate.value = message;
    graceUpdateContent.value = "";
    graceUpdateError.value = "";
    graceUpdateBusy.value = false;
    clearGraceUpdatePhoto();
  }

  function closeGraceUpdateEditor(force = false) {
    if (graceUpdateBusy.value && !force) return;
    pendingGraceUpdate.value = null;
    graceUpdateContent.value = "";
    graceUpdateError.value = "";
    clearGraceUpdatePhoto();
  }

  function handleGraceUpdatePhotoPick(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    clearGraceUpdatePhoto();
    graceUpdatePhoto.value = file;
    graceUpdatePhotoPreview.value = URL.createObjectURL(file);
    graceUpdateError.value = "";
  }

  async function publishGraceUpdate() {
    const message = pendingGraceUpdate.value;
    const content = escapeHtmlText(graceUpdateContent.value.trim());
    if (!message || !graceUpdateCanPublish.value || graceUpdateBusy.value) return;
    graceUpdateBusy.value = true;
    graceUpdateError.value = "";
    try {
      let imageMessageId: number | null = null;
      if (graceUpdatePhoto.value) {
        const upload = await options.uploadFile(graceUpdatePhoto.value, { channelId: message.channelId, suppressAlert: true });
        if (!upload.success || !upload.messageId) throw new Error("照片上传失败，请重试");
        imageMessageId = upload.messageId;
      }
      const result = await api<{ success: boolean; message: MessageDTO }>(`/api/messages/${message.id}/grace-update`, {
        method: "POST",
        body: JSON.stringify({ content, imageMessageId })
      });
      if (result.message) options.onSubmitted(result.message);
      closeGraceUpdateEditor(true);
      await nextTick();
      options.scrollBottom?.(true);
    } catch (error) {
      graceUpdateError.value = error instanceof Error ? error.message : "更新见证失败";
    } finally {
      graceUpdateBusy.value = false;
    }
  }

  async function withdrawGrace(message: MessageDTO) {
    if (!window.confirm("撤回这条恩典见证？")) return;
    await api(`/api/messages/${message.id}/grace`, { method: "DELETE" });
    await options.onDeleted?.();
  }

  return {
    graceComposerOpen,
    graceBusy,
    graceError,
    graceContent,
    gracePhoto,
    gracePhotoPreview,
    graceCanSubmit,
    pendingGraceUpdate,
    graceUpdateContent,
    graceUpdateBusy,
    graceUpdateError,
    graceUpdatePhotoPreview,
    graceUpdateCanPublish,
    graceActionText,
    graceLatestTime,
    clearGracePhoto,
    handleGracePhotoPick,
    openGraceComposer,
    closeGraceComposer,
    submitGrace,
    markGraceGrateful,
    clearGraceUpdatePhoto,
    openGraceUpdateEditor,
    closeGraceUpdateEditor,
    handleGraceUpdatePhotoPick,
    publishGraceUpdate,
    withdrawGrace,
    ...recording
  };
}
