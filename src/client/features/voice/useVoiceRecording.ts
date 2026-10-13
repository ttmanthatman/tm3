import { computed, getCurrentScope, onScopeDispose, ref, watch, type Ref } from "vue";
import { voiceDraftStorage, type VoiceDraftStorage } from "./voiceDrafts";
import { createRecordingWakeLock, createVoiceRecordingSession, type VoiceRecordingSession } from "./voiceRecording";
import { createVoiceMicrophone } from "./voiceMicrophone";

type VoiceUploadOptions = { voice?: boolean; durationMs?: number; waveform?: number[]; pendingMessageId?: number; originalImage?: boolean; channelId?: number };
type UploadFileFn = (file: File, options?: VoiceUploadOptions) => Promise<{ success: boolean; duplicate: boolean; skipped: boolean }>;

interface UseVoiceRecordingOptions {
  composerPanel: Ref<"voice" | "more" | null>;
  accountId?: () => number | null;
  draftStorage?: VoiceDraftStorage;
  // Pending-message creation and the XHR upload flow stay in App.vue (shared
  // with file/image uploads); the recording flow drives them through these.
  pushPendingVoiceMessage: (file: File, options: { durationMs?: number; waveform?: number[] }) => 0 | { id: number; channelId: number } | Promise<0 | { id: number; channelId: number }>;
  uploadFile: UploadFileFn;
}

export function useVoiceRecording(options: UseVoiceRecordingOptions) {
  const mediaRecorder = ref<MediaRecorder | null>(null);
  const isRecording = ref(false);
  const recordingStarting = ref(false);
  const recordingFinalizing = ref(false);
  const draftLoading = ref(false);
  const recordingBusy = computed(() => recordingStarting.value || recordingFinalizing.value || draftLoading.value);
  const audioPreviewUrl = ref("");
  const audioFile = ref<File | null>(null);
  const audioPreviewWaveform = ref<number[]>([]);
  const audioPreviewDurationMs = ref(0);
  const previewAudioEl = ref<HTMLAudioElement | null>(null);
  const previewPlaying = ref(false);
  const previewProgress = ref(0);
  const voiceSending = ref(false);
  const recordingDuration = ref(0);
  const recordingStatus = ref("");
  const recordingNotice = ref("");
  let recordingTimer: number | undefined;
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let detachInputListeners: (() => void) | null = null;
  let finalizeActiveRecording: ((reason: "user" | "interrupted") => void) | null = null;
  let revision = 0;
  let disposed = false;
  const storage = options.draftStorage || voiceDraftStorage;
  let storageQueue = Promise.resolve();
  const panelPinned = computed(() => recordingBusy.value || isRecording.value || !!audioFile.value);
  watch(options.composerPanel, (panel) => {
    if (panelPinned.value && panel !== "voice") options.composerPanel.value = "voice";
  }, { flush: "sync" });

  function queueStorage(operation: () => Promise<void>) {
    const ticket = revision;
    storageQueue = storageQueue.then(operation).catch((error: unknown) => {
      if (!disposed && ticket === revision) recordingNotice.value = `无法保存或清除本机录音草稿：${error instanceof Error ? error.message : "存储失败"}。请保持页面打开并发送录音。`;
    });
    return storageQueue;
  }

  function persistDraft() {
    const accountId = options.accountId?.();
    const file = audioFile.value;
    if (!accountId || !file) return Promise.resolve();
    const draft = { accountId, file, name: file.name, durationMs: audioPreviewDurationMs.value, waveform: [...audioPreviewWaveform.value], notice: recordingNotice.value };
    return queueStorage(() => storage.save(draft));
  }
  let activeVoiceRecordingSession: VoiceRecordingSession | null = null;
  const recordingWakeLock = createRecordingWakeLock(navigator);
  const microphone = createVoiceMicrophone(() => navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  }));
  let activeMicrophoneStream: MediaStream | null = null;

  function pickAudioMimeType() {
    const recorder = window.MediaRecorder;
    const candidates = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
    return candidates.find((type) => recorder.isTypeSupported?.(type)) || "";
  }

  function audioExtensionFromMime(type: string) {
    if (type.includes("mp4") || type.includes("aac")) return "m4a";
    if (type.includes("ogg")) return "ogg";
    if (type.includes("mpeg")) return "mp3";
    if (type.includes("wav")) return "wav";
    return "webm";
  }

  function clearRecordingTimer() {
    if (recordingTimer !== undefined) window.clearInterval(recordingTimer);
    recordingTimer = undefined;
  }

  function clearCaptureListeners() {
    clearTimeout(startupTimer);
    startupTimer = undefined;
    detachInputListeners?.();
    detachInputListeners = null;
  }

  function clearRecording(clearDraft: boolean) {
    revision += 1;
    clearCaptureListeners();
    if (recordingStarting.value) microphone.release();
    recordingStarting.value = false;
    recordingFinalizing.value = false;
    draftLoading.value = false;
    const accountId = options.accountId?.();
    if (clearDraft && accountId) void queueStorage(() => storage.delete(accountId));
    const recorder = mediaRecorder.value;
    const session = activeVoiceRecordingSession;
    if (recorder && session) session.stop(recorder, "discard");
    else if (recorder && recorder.state !== "inactive") recorder.stop();
    if (activeMicrophoneStream) microphone.finish(activeMicrophoneStream);
    activeMicrophoneStream = null;
    previewAudioEl.value?.pause();
    mediaRecorder.value = null;
    activeVoiceRecordingSession = null;
    finalizeActiveRecording = null;
    isRecording.value = false;
    recordingDuration.value = 0;
    recordingStatus.value = "";
    recordingNotice.value = "";
    audioFile.value = null;
    audioPreviewWaveform.value = [];
    audioPreviewDurationMs.value = 0;
    previewPlaying.value = false;
    previewProgress.value = 0;
    clearRecordingTimer();
    void recordingWakeLock.release();
    if (audioPreviewUrl.value) URL.revokeObjectURL(audioPreviewUrl.value);
    audioPreviewUrl.value = "";
  }

  function resetRecording() { clearRecording(true); }

  async function startRecording() {
    if (disposed || recordingBusy.value || isRecording.value || audioFile.value || voiceSending.value) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      alert("当前浏览器不支持录音");
      return;
    }
    clearRecording(false);
    const ticket = revision;
    recordingStarting.value = true;
    options.composerPanel.value = "voice";
    recordingStatus.value = "正在申请麦克风…";
    recordingNotice.value = "若出现系统提示，请允许麦克风访问。开始计时后再说话。";
    let stream: MediaStream | undefined;
    try {
      stream = await microphone.acquire();
      if (disposed || ticket !== revision) { microphone.finish(stream); return; }
      const activeStream = stream;
      activeMicrophoneStream = stream;
      const mimeType = pickAudioMimeType();
      const recorderOptions: MediaRecorderOptions = { audioBitsPerSecond: 16000 };
      if (mimeType) recorderOptions.mimeType = mimeType;
      const recorder = new MediaRecorder(stream, recorderOptions);
      const session = createVoiceRecordingSession();
      const chunks: Blob[] = [];
      let startedAt = 0;
      mediaRecorder.value = recorder;
      activeVoiceRecordingSession = session;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      const finalize = (reason: "user" | "interrupted") => {
        if (activeVoiceRecordingSession !== session || recordingFinalizing.value) return;
        clearCaptureListeners();
        if (isRecording.value) recordingDuration.value = Math.max(recordingDuration.value, Date.now() - startedAt);
        clearRecordingTimer();
        recordingStarting.value = false;
        isRecording.value = false;
        recordingFinalizing.value = true;
        recordingStatus.value = reason === "user" ? "正在保留录音…" : "麦克风访问已中断，正在保留已录部分…";
        void recordingWakeLock.release();
        session.stop(recorder, reason);
        // stop() queues final data; capture can be released immediately.
        microphone.finish(activeStream);
        if (activeMicrophoneStream === activeStream) activeMicrophoneStream = null;
      };
      finalizeActiveRecording = finalize;
      const interrupted = () => finalize("interrupted");
      const tracks = activeStream.getAudioTracks();
      for (const track of tracks) {
        track.addEventListener("mute", interrupted);
        track.addEventListener("ended", interrupted);
      }
      detachInputListeners = () => {
        for (const track of tracks) {
          track.removeEventListener("mute", interrupted);
          track.removeEventListener("ended", interrupted);
        }
      };
      recorder.onstop = () => {
        const outcome = session.consumeStop();
        const isActiveSession = activeVoiceRecordingSession === session;
        microphone.finish(activeStream);
        if (activeMicrophoneStream === activeStream) activeMicrophoneStream = null;
        if (isActiveSession && typeof document !== "undefined" && document.hidden) microphone.release();
        if (isActiveSession) {
          clearCaptureListeners();
          recordingStarting.value = false;
          if (isRecording.value && !recordingFinalizing.value) recordingDuration.value = Math.max(recordingDuration.value, Date.now() - startedAt);
          clearRecordingTimer();
          isRecording.value = false;
          recordingFinalizing.value = false;
          mediaRecorder.value = null;
          activeVoiceRecordingSession = null;
          finalizeActiveRecording = null;
          void recordingWakeLock.release();
        }
        if (!outcome.keepPreview || !isActiveSession) return;
        const type = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunks, { type });
        if (!blob.size) {
          recordingStatus.value = "没有录到声音";
          recordingNotice.value = "麦克风未提供可保存的音频。请重新录音；若仍失败，请检查系统麦克风权限。";
          return;
        }
        const ext = audioExtensionFromMime(type);
        audioFile.value = new File([blob], `语音消息-${Date.now()}.${ext}`, { type });
        audioPreviewUrl.value = URL.createObjectURL(blob);
        audioPreviewDurationMs.value = recordingDuration.value;
        audioPreviewWaveform.value = fallbackWaveform(Date.now());
        const file = audioFile.value;
        void analyzeAudioBlob(blob).then((result) => {
          if (disposed || ticket !== revision || audioFile.value !== file) return;
          if (outcome.reason === "interrupted" || audioPreviewDurationMs.value <= 0) {
            audioPreviewDurationMs.value = result.durationMs || recordingDuration.value;
          }
          audioPreviewWaveform.value = result.waveform;
          void persistDraft();
        });
        recordingStatus.value = "录音已完成";
        recordingNotice.value = outcome.reason === "interrupted"
          ? "录音被系统提前中断，下面只保留了中断前的部分。请保持屏幕亮起并停留在聊天室后重录。"
          : "";
        void persistDraft();
      };
      recorder.onerror = interrupted;
      recorder.onstart = () => {
        if (disposed || ticket !== revision || activeVoiceRecordingSession !== session || recordingFinalizing.value) return;
        if (tracks.some((track) => track.readyState !== "live" || track.muted || !track.enabled)) { interrupted(); return; }
        clearTimeout(startupTimer);
        startupTimer = undefined;
        startedAt = Date.now();
        recordingStarting.value = false;
        isRecording.value = true;
        recordingStatus.value = "正在录音，请保持屏幕亮起";
        recordingNotice.value = "";
        recordingTimer = window.setInterval(() => {
          recordingDuration.value = Date.now() - startedAt;
          if (tracks.some((track) => track.readyState !== "live" || track.muted || !track.enabled)) interrupted();
        }, 250);
        void recordingWakeLock.acquire().then((held) => {
          if (held && activeVoiceRecordingSession === session && isRecording.value) recordingStatus.value = "正在录音";
        });
      };
      recordingStatus.value = "麦克风已连接，正在启动录音…";
      startupTimer = setTimeout(() => {
        if (activeVoiceRecordingSession !== session || !recordingStarting.value) return;
        clearRecording(false);
        recordingStatus.value = "录音未能启动，请重试";
      }, 10_000);
      session.start(recorder);
    } catch (error) {
      if (stream) microphone.finish(stream);
      if (disposed || ticket !== revision) return;
      microphone.release();
      clearRecording(false);
      const name = error instanceof Error ? error.name : "";
      recordingStatus.value = name === "NotAllowedError" ? "麦克风权限未允许" : "无法开始录音";
      recordingNotice.value = name === "NotAllowedError"
        ? "请在系统或浏览器设置中允许麦克风访问，然后重新录音。"
        : "麦克风没有提供可用输入，请重新录音；若仍失败，请检查系统麦克风权限。";
    }
  }

  function stopRecording() { finalizeActiveRecording?.("user"); }

  async function sendVoice() {
    if (!audioFile.value || voiceSending.value) return;
    const file = audioFile.value;
    const uploadOptions = { durationMs: audioPreviewDurationMs.value || recordingDuration.value, waveform: audioPreviewWaveform.value };
    voiceSending.value = true;
    try {
      const pending = await options.pushPendingVoiceMessage(file, uploadOptions);
      if (!pending) return;
      resetRecording();
      options.composerPanel.value = null;
      await options.uploadFile(file, { voice: true, ...uploadOptions, pendingMessageId: pending.id, channelId: pending.channelId });
    } finally {
      voiceSending.value = false;
    }
  }

  function formatDuration(ms: number) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function fallbackWaveform(seed: number, bars = 48) {
    return Array.from({ length: bars }, (_, index) => {
      const value = Math.abs(Math.sin((index + 1) * 1.37 + seed * 0.013) * 0.75 + Math.sin(index * 0.41) * 0.25);
      return Math.min(1, Math.max(0.16, value));
    });
  }

  async function analyzeAudioBlob(blob: Blob, bars = 48) {
    const fallback = { durationMs: audioPreviewDurationMs.value || recordingDuration.value, waveform: fallbackWaveform(Date.now(), bars) };
    let context: AudioContext | undefined;
    try {
      const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return fallback;
      context = new AudioContextCtor();
      const buffer = await context.decodeAudioData(await blob.arrayBuffer());
      const channel = buffer.getChannelData(0);
      const blockSize = Math.max(1, Math.floor(channel.length / bars));
      const waveform = Array.from({ length: bars }, (_, index) => {
        const start = index * blockSize;
        const end = Math.min(channel.length, start + blockSize);
        let sum = 0;
        for (let cursor = start; cursor < end; cursor += 1) sum += Math.abs(channel[cursor]);
        return sum / Math.max(1, end - start);
      });
      const max = Math.max(...waveform, 0.01);
      return { durationMs: Math.round(buffer.duration * 1000), waveform: waveform.map((bar) => Math.min(1, Math.max(0.1, bar / max))) };
    } catch {
      return fallback;
    } finally {
      if (context && context.state !== "closed") {
        try { await context.close(); } catch { /* The browser may already have closed the context. */ }
      }
    }
  }

  function voiceBarStyle(bar: number, index: number, total: number, progress: number) {
    return {
      height: `${Math.round(7 + bar * 25)}px`,
      opacity: index / Math.max(1, total) <= progress ? 1 : 0.52
    };
  }

  function togglePreviewPlayback() {
    const audio = previewAudioEl.value;
    if (!audio) return;
    if (previewPlaying.value) {
      audio.pause();
      previewPlaying.value = false;
      return;
    }
    void audio.play();
    previewPlaying.value = true;
  }

  function updatePreviewProgress() {
    const audio = previewAudioEl.value;
    if (!audio?.duration) return;
    previewProgress.value = Math.min(1, Math.max(0, audio.currentTime / audio.duration));
  }

  function syncPreviewMetadata() {
    const audio = previewAudioEl.value;
    if (audioPreviewDurationMs.value <= 0 && audio && Number.isFinite(audio.duration) && audio.duration > 0) audioPreviewDurationMs.value = Math.round(audio.duration * 1000);
  }

  function endPreviewPlayback() {
    previewPlaying.value = false;
    previewProgress.value = 0;
  }

  // Called from App.vue's handleDocumentVisibilityChange, which owns the other
  // visibility reactions (read position, effects, music lyrics header).
  function handleRecordingVisibilityChange(visible: boolean) {
    if (!visible) {
      if (isRecording.value) {
        finalizeActiveRecording?.("interrupted");
        recordingNotice.value = "录音因锁屏或切换应用而停止，请试听后发送，或重新录音。";
      }
      else if (recordingStarting.value) {
        clearRecording(false);
        options.composerPanel.value = null;
      } else microphone.release();
      return;
    }
    if (isRecording.value) {
      void recordingWakeLock.acquire().then((held) => {
        if (isRecording.value) recordingStatus.value = held ? "正在录音" : "正在录音，请保持屏幕亮起";
      });
    }
  }

  if (options.accountId) {
    watch(options.accountId, async (accountId) => {
      microphone.release();
      clearRecording(false);
      options.composerPanel.value = null;
      if (!accountId) return;
      const ticket = revision;
      draftLoading.value = true;
      try {
        await storageQueue;
        const draft = await storage.load(accountId);
        if (disposed || ticket !== revision || !draft || !(draft.file instanceof Blob)) return;
        audioFile.value = new File([draft.file], draft.name, { type: draft.file.type });
        audioPreviewUrl.value = URL.createObjectURL(audioFile.value);
        recordingDuration.value = audioPreviewDurationMs.value = draft.durationMs;
        audioPreviewWaveform.value = draft.waveform;
        recordingStatus.value = "录音已完成";
        recordingNotice.value = draft.notice;
        options.composerPanel.value = "voice";
      } catch (error) {
        if (ticket === revision) recordingNotice.value = `无法读取本机录音草稿：${error instanceof Error ? error.message : "存储失败"}`;
      } finally {
        if (ticket === revision) draftLoading.value = false;
      }
    }, { immediate: true, flush: "sync" });
  }

  function handleOutsidePointer(event: PointerEvent) {
    if (options.composerPanel.value !== "voice" || panelPinned.value) return;
    const target = event.target;
    if (target instanceof Element && !target.closest(".voice-drawer, [data-voice-toggle]")) options.composerPanel.value = null;
  }
  // A stopped draft is already saved; leaving the page must not delete it.
  function disposeRecording() {
    disposed = true;
    microphone.release();
    clearRecording(false);
  }
  function handlePageHide() {
    if (recordingStarting.value) clearRecording(false);
    if (isRecording.value) finalizeActiveRecording?.("interrupted");
    microphone.release();
  }
  if (typeof document !== "undefined") document.addEventListener("pointerdown", handleOutsidePointer);
  if (typeof window !== "undefined") window.addEventListener("pagehide", handlePageHide);
  if (getCurrentScope()) onScopeDispose(() => {
    if (typeof document !== "undefined") document.removeEventListener("pointerdown", handleOutsidePointer);
    if (typeof window !== "undefined") window.removeEventListener("pagehide", handlePageHide);
    disposeRecording();
  });

  return {
    isRecording,
    recordingBusy,
    disposeRecording,
    audioPreviewUrl,
    audioFile,
    audioPreviewWaveform,
    audioPreviewDurationMs,
    previewAudioEl,
    previewPlaying,
    previewProgress,
    voiceSending,
    recordingDuration,
    recordingStatus,
    recordingNotice,
    resetRecording,
    startRecording,
    stopRecording,
    sendVoice,
    formatDuration,
    voiceBarStyle,
    togglePreviewPlayback,
    updatePreviewProgress,
    syncPreviewMetadata,
    endPreviewPlayback,
    handleRecordingVisibilityChange
  };
}
