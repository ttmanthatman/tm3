import { computed, ref } from "vue";
import type { ChannelDTO, GracePayload, MessageDTO } from "@shared/types";
import { api } from "../../api";
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
  jumpToMessage: (channelId: number, messageId: number) => Promise<void>;
  notify: (text: string) => void;
}

export function gracePayload(message: MessageDTO): GracePayload {
  const raw = (message.payload || {}) as Partial<GracePayload>;
  return {
    kind: "grace",
    voiceMessageId: Number(raw.voiceMessageId || 0) > 0 ? Number(raw.voiceMessageId) : null,
    imageMessageId: Number(raw.imageMessageId || 0) > 0 ? Number(raw.imageMessageId) : null,
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
  // The recording flow is reused from the composer; its pending-message/send
  // path stays unused here because grace voice uploads go through submitGrace.
  const graceRecordingPanel = ref<"voice" | "more" | null>(null);
  const recording = useVoiceRecording({
    composerPanel: graceRecordingPanel,
    pushPendingVoiceMessage: () => 0,
    uploadFile: (file, uploadOptions) => options.uploadFile(file, uploadOptions)
  });

  const graceCanSubmit = computed(() => graceSubmissionReady(graceContent.value, !!recording.audioFile.value));

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
    graceContent.value = "";
    graceError.value = "";
    clearGracePhoto();
    recording.resetRecording();
  }

  async function submitGrace() {
    const content = graceContent.value.trim();
    const voiceFile = recording.audioFile.value;
    if (graceBusy.value) return;
    if (!graceSubmissionReady(content, !!voiceFile)) {
      graceError.value = "写下一段文字或录一段语音，再存入恩典册";
      return;
    }
    graceBusy.value = true;
    graceError.value = "";
    try {
      const { channel } = await api<{ channel: ChannelDTO }>("/api/grace/channel");
      let voiceMessageId: number | undefined;
      let imageMessageId: number | undefined;
      if (voiceFile) {
        const upload = await options.uploadFile(voiceFile, {
          voice: true,
          durationMs: recording.audioPreviewDurationMs.value || recording.recordingDuration.value,
          waveform: recording.audioPreviewWaveform.value,
          channelId: channel.id,
          suppressAlert: true
        });
        if (!upload.success || !upload.messageId) throw new Error("语音上传失败，请重试");
        voiceMessageId = upload.messageId;
      }
      if (gracePhoto.value) {
        const upload = await options.uploadFile(gracePhoto.value, { channelId: channel.id, suppressAlert: true });
        if (!upload.success || !upload.messageId) throw new Error("照片上传失败，请重试");
        imageMessageId = upload.messageId;
      }
      const result = await api<{ success: boolean; message: MessageDTO }>("/api/grace", {
        method: "POST",
        body: JSON.stringify({ content: content || undefined, voiceMessageId, imageMessageId })
      });
      const messageId = result.message?.id;
      closeGraceComposer(true);
      options.notify("已存入数算恩典");
      if (messageId) await options.jumpToMessage(channel.id, messageId);
    } catch (error) {
      graceError.value = error instanceof Error ? error.message : "存入恩典失败，请重试";
    } finally {
      graceBusy.value = false;
    }
  }

  return {
    graceComposerOpen,
    graceBusy,
    graceError,
    graceContent,
    gracePhoto,
    gracePhotoPreview,
    graceCanSubmit,
    clearGracePhoto,
    handleGracePhotoPick,
    openGraceComposer,
    closeGraceComposer,
    submitGrace,
    ...recording
  };
}
