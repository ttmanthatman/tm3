import { computed, nextTick, ref } from "vue";
import type { GraceImage, GracePayload, MessageDTO } from "@shared/types";
import { useGracePhotos } from "./useGracePhotos";
import { graceEditText, graceRequestBody } from "./graceImages";
import { graceImages, graceNativeVoice } from "@shared/grace";
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
  currentMessage?: (id: number) => MessageDTO | undefined;
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
    sourceStoryId: raw.sourceStoryId,
    nativeVoice: graceNativeVoice(raw),
    voiceMessageId: Number(raw.voiceMessageId || 0) > 0 ? Number(raw.voiceMessageId) : null,
    imageMessageId: Number(raw.imageMessageId || 0) > 0 ? Number(raw.imageMessageId) : null,
    images: graceImages(raw),
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

// 文字、语音和照片至少有一项，包括转发来的纯媒体故事。
export function graceSubmissionReady(content: string, hasVoice: boolean, hasPhotos = false): boolean {
  return !!content.trim() || hasVoice || hasPhotos;
}

export function useGrace(options: UseGraceOptions) {
  const graceComposerOpen = ref(false);
  const graceBusy = ref(false);
  const graceError = ref("");
  const graceContent = ref("");
  const graceTargetChannelId = ref<number | null>(null);
  const pendingGraceUpdate = ref<MessageDTO | null>(null);
  const graceUpdateContent = ref("");
  const graceUpdateBusy = ref(false);
  const graceUpdateError = ref("");
  const graceUpdateImages = ref<GraceImage[]>([]);
  const graceUpdateImageMessageId = ref<number | null>(null);
  const composerPhotos = useGracePhotos(() => graceTargetChannelId.value, () => 0, (error) => { graceError.value = error; });
  const updatePhotos = useGracePhotos(() => pendingGraceUpdate.value?.channelId || null, () => graceUpdateImages.value.length + (graceUpdateImageMessageId.value ? 1 : 0), (error) => { graceUpdateError.value = error; });
  // The recording flow is reused from the composer; its pending-message/send
  // path stays unused here because grace voice uploads go through submitGrace.
  const graceRecordingPanel = ref<"voice" | "more" | null>(null);
  const recording = useVoiceRecording({
    composerPanel: graceRecordingPanel,
    pushPendingVoiceMessage: () => 0,
    uploadFile: (file, uploadOptions) => options.uploadFile(file, uploadOptions)
  });

  const graceCanSubmit = computed(() => !composerPhotos.photoBusy.value && !recording.isRecording.value && graceSubmissionReady(graceContent.value, !!recording.audioFile.value, composerPhotos.photos.value.length > 0));
  const graceUpdateCanPublish = computed(() => !updatePhotos.photoBusy.value && graceSubmissionReady(graceUpdateContent.value,
    !!(pendingGraceUpdate.value && (gracePayload(pendingGraceUpdate.value).voiceMessageId || gracePayload(pendingGraceUpdate.value).nativeVoice)),
    graceUpdateImages.value.length + updatePhotos.photos.value.length + (graceUpdateImageMessageId.value ? 1 : 0) > 0));

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

  const clearGracePhoto = composerPhotos.clear;
  const handleGracePhotoPick = composerPhotos.pick;

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
    if (graceBusy.value || composerPhotos.photoBusy.value) return;
    if (!graceSubmissionReady(content, !!voiceFile, composerPhotos.photos.value.length > 0)) {
      graceError.value = "写下文字、附上照片或录一段语音，再存入恩典册";
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
      const result = await api<{ success: boolean; message: MessageDTO }>("/api/grace", {
        method: "POST",
        body: graceRequestBody({ channelId, content: content || undefined, voiceMessageId }, composerPhotos.photos.value)
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
    updatePhotos.clear();
    graceUpdateImages.value = [];
    graceUpdateImageMessageId.value = null;
  }

  function openGraceUpdateEditor(message: MessageDTO) {
    const sourceId = gracePayload(message).sourceGraceMessageId || message.id;
    message = options.currentMessage?.(sourceId) || message;
    pendingGraceUpdate.value = message;
    graceUpdateContent.value = graceEditText(message.content || "");
    graceUpdateError.value = "";
    graceUpdateBusy.value = false;
    clearGraceUpdatePhoto();
    graceUpdateImages.value = [...graceImages(message.payload)];
    graceUpdateImageMessageId.value = gracePayload(message).imageMessageId || null;
  }

  function closeGraceUpdateEditor(force = false) {
    if (graceUpdateBusy.value && !force) return;
    pendingGraceUpdate.value = null;
    graceUpdateContent.value = "";
    graceUpdateError.value = "";
    clearGraceUpdatePhoto();
  }

  const handleGraceUpdatePhotoPick = updatePhotos.pick;

  async function publishGraceUpdate() {
    const message = pendingGraceUpdate.value;
    const content = escapeHtmlText(graceUpdateContent.value.trim());
    if (!message || !graceUpdateCanPublish.value || graceUpdateBusy.value) return;
    graceUpdateBusy.value = true;
    graceUpdateError.value = "";
    try {
      const result = await api<{ success: boolean; message: MessageDTO; unchanged?: boolean }>(`/api/messages/${message.id}/grace-update`, {
        method: "POST",
        body: graceRequestBody({ content, imageMessageId: graceUpdateImageMessageId.value, retainedImages: graceUpdateImages.value.map((image) => image.fileName), expectedUpdateAt: gracePayload(message).latestUpdateAt || null }, updatePhotos.photos.value)
      });
      if (result.message) {
        if (result.unchanged) options.onUpdated?.(result.message);
        else options.onSubmitted(result.message);
      }
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
    gracePhotos: composerPhotos.photos,
    gracePhotoBusy: composerPhotos.photoBusy,
    removeGracePhoto: composerPhotos.remove,
    graceCanSubmit,
    pendingGraceUpdate,
    graceUpdateContent,
    graceUpdateBusy,
    graceUpdateError,
    graceUpdatePhotos: updatePhotos.photos,
    graceUpdatePhotoBusy: updatePhotos.photoBusy,
    removeGraceUpdatePhoto: updatePhotos.remove,
    graceUpdateImages,
    graceUpdateImageMessageId,
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
