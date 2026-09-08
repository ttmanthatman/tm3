import { ref, type Ref } from "vue";
import { createRecordingWakeLock, createVoiceRecordingSession, type VoiceRecordingSession } from "./voiceRecording";

type VoiceUploadOptions = { voice?: boolean; durationMs?: number; waveform?: number[]; pendingMessageId?: number; originalImage?: boolean };
type UploadFileFn = (file: File, options?: VoiceUploadOptions) => Promise<{ success: boolean; duplicate: boolean; skipped: boolean }>;

interface UseVoiceRecordingOptions {
  composerPanel: Ref<"voice" | "more" | null>;
  // Pending-message creation and the XHR upload flow stay in App.vue (shared
  // with file/image uploads); the recording flow drives them through these.
  pushPendingVoiceMessage: (file: File, options: { durationMs?: number; waveform?: number[] }) => number;
  uploadFile: UploadFileFn;
}

export function useVoiceRecording(options: UseVoiceRecordingOptions) {
  const mediaRecorder = ref<MediaRecorder | null>(null);
  const isRecording = ref(false);
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
  let activeVoiceRecordingSession: VoiceRecordingSession | null = null;
  const recordingWakeLock = createRecordingWakeLock(navigator);

  function pickAudioMimeType() {
    const recorder = window.MediaRecorder;
    const candidates = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
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
    if (recordingTimer) window.clearInterval(recordingTimer);
    recordingTimer = undefined;
  }

  function resetRecording() {
    const recorder = mediaRecorder.value;
    const session = activeVoiceRecordingSession;
    if (recorder && session) session.stop(recorder, "discard");
    else if (recorder && recorder.state !== "inactive") recorder.stop();
    previewAudioEl.value?.pause();
    mediaRecorder.value = null;
    activeVoiceRecordingSession = null;
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

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      alert("当前浏览器不支持录音");
      return;
    }
    resetRecording();
    recordingStatus.value = "准备录音…";
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      const activeStream = stream;
      const mimeType = pickAudioMimeType();
      const recorderOptions: MediaRecorderOptions = { audioBitsPerSecond: 16000 };
      if (mimeType) recorderOptions.mimeType = mimeType;
      const recorder = new MediaRecorder(stream, recorderOptions);
      const session = createVoiceRecordingSession();
      const chunks: Blob[] = [];
      const startedAt = Date.now();
      mediaRecorder.value = recorder;
      activeVoiceRecordingSession = session;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        const outcome = session.consumeStop();
        const isActiveSession = activeVoiceRecordingSession === session;
        activeStream.getTracks().forEach((track) => track.stop());
        if (isActiveSession) {
          recordingDuration.value = Math.max(recordingDuration.value, Date.now() - startedAt);
          clearRecordingTimer();
          isRecording.value = false;
          mediaRecorder.value = null;
          activeVoiceRecordingSession = null;
          void recordingWakeLock.release();
        }
        if (!outcome.keepPreview || !isActiveSession) return;
        const type = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunks, { type });
        if (!blob.size) {
          recordingStatus.value = "没有录到声音";
          recordingNotice.value = outcome.reason === "interrupted" ? "录音被系统提前中断，而且没有保留下声音。请保持屏幕亮起并停留在聊天室后重录。" : "";
          return;
        }
        const ext = audioExtensionFromMime(type);
        audioFile.value = new File([blob], `语音消息-${Date.now()}.${ext}`, { type });
        audioPreviewUrl.value = URL.createObjectURL(blob);
        audioPreviewDurationMs.value = recordingDuration.value;
        audioPreviewWaveform.value = fallbackWaveform(Date.now());
        void analyzeAudioBlob(blob).then((result) => {
          audioPreviewDurationMs.value = result.durationMs || recordingDuration.value;
          audioPreviewWaveform.value = result.waveform;
        });
        recordingStatus.value = "录音已完成";
        recordingNotice.value = outcome.reason === "interrupted"
          ? "录音被系统提前中断，下面只保留了中断前的部分。请保持屏幕亮起并停留在聊天室后重录。"
          : "";
      };
      recorder.onerror = () => {
        if (activeVoiceRecordingSession === session) recordingStatus.value = "录音发生错误，正在保留已录部分";
      };
      session.start(recorder);
      isRecording.value = true;
      recordingStatus.value = "正在录音";
      recordingTimer = window.setInterval(() => {
        recordingDuration.value = Date.now() - startedAt;
      }, 250);
      void recordingWakeLock.acquire().then((held) => {
        if (!held && activeVoiceRecordingSession === session && isRecording.value) {
          recordingStatus.value = "正在录音，请保持屏幕亮起";
        }
      });
    } catch {
      stream?.getTracks().forEach((track) => track.stop());
      recordingStatus.value = "";
      options.composerPanel.value = null;
      alert("无法开始录音，请允许麦克风权限");
    }
  }

  function stopRecording() {
    const recorder = mediaRecorder.value;
    if (!recorder || recorder.state === "inactive") return;
    if (activeVoiceRecordingSession) activeVoiceRecordingSession.stop(recorder, "user");
    else recorder.stop();
  }

  async function sendVoice() {
    if (!audioFile.value || voiceSending.value) return;
    const file = audioFile.value;
    const uploadOptions = { durationMs: audioPreviewDurationMs.value || recordingDuration.value, waveform: audioPreviewWaveform.value };
    const pendingMessageId = options.pushPendingVoiceMessage(file, uploadOptions);
    if (!pendingMessageId) return;
    voiceSending.value = true;
    resetRecording();
    options.composerPanel.value = null;
    try {
      await options.uploadFile(file, { voice: true, ...uploadOptions, pendingMessageId });
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
    try {
      const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return fallback;
      const context = new AudioContextCtor();
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
      await context.close();
      const max = Math.max(...waveform, 0.01);
      return { durationMs: Math.round(buffer.duration * 1000), waveform: waveform.map((bar) => Math.min(1, Math.max(0.1, bar / max))) };
    } catch {
      return fallback;
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
    if (audio?.duration) audioPreviewDurationMs.value = Math.round(audio.duration * 1000);
  }

  function endPreviewPlayback() {
    previewPlaying.value = false;
    previewProgress.value = 0;
  }

  // Called from App.vue's handleDocumentVisibilityChange, which owns the other
  // visibility reactions (read position, effects, music lyrics header).
  function handleRecordingVisibilityChange(visible: boolean) {
    if (!visible) {
      if (isRecording.value) recordingStatus.value = "录音可能因锁屏或切换应用而中断";
      return;
    }
    if (isRecording.value) {
      void recordingWakeLock.acquire().then((held) => {
        recordingStatus.value = held ? "正在录音" : "正在录音，请保持屏幕亮起";
      });
    }
  }

  return {
    isRecording,
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
