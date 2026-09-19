import { onBeforeUnmount, ref } from "vue";
import { STORY_LIMITS } from "@shared/stories";
import { createRecordingWakeLock, createVoiceRecordingSession } from "../voice/voiceRecording";

export function useStoryRecording() {
  const file = ref<File | null>(null);
  const preview = ref("");
  const recording = ref(false);
  const starting = ref(false);
  const durationMs = ref(0);
  const error = ref("");
  const wakeLock = createRecordingWakeLock(navigator);
  let recorder: MediaRecorder | null = null;
  let session = createVoiceRecordingSession();
  let timer: ReturnType<typeof setInterval> | undefined;
  let version = 0;
  let stream: MediaStream | null = null;

  function clear() {
    version += 1;
    if (recorder) session.stop(recorder, "discard");
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    recorder = null;
    clearInterval(timer);
    recording.value = false;
    starting.value = false;
    file.value = null;
    durationMs.value = 0;
    if (preview.value) URL.revokeObjectURL(preview.value);
    preview.value = "";
    void wakeLock.release();
  }
  function stop() { if (recorder) session.stop(recorder, "user"); }
  async function start() {
    clear();
    const ticket = version;
    error.value = "";
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { error.value = "当前浏览器不支持录音，请使用支持麦克风的浏览器"; return; }
    starting.value = true;
    try {
      const captured = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      if (ticket !== version) { captured.getTracks().forEach((track) => track.stop()); return; }
      stream = captured;
      const mimeType = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type));
      const current = new MediaRecorder(captured, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32_000 });
      recorder = current;
      const currentSession = createVoiceRecordingSession();
      session = currentSession;
      const chunks: Blob[] = [];
      const began = Date.now();
      current.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      current.onstop = () => {
        captured.getTracks().forEach((track) => track.stop());
        const outcome = currentSession.consumeStop();
        if (ticket !== version) return;
        clearInterval(timer);
        recorder = null;
        stream = null;
        recording.value = false;
        void wakeLock.release();
        if (!outcome.keepPreview) return;
        const blob = new Blob(chunks, { type: current.mimeType });
        if (!blob.size) { error.value = "没有录到声音，请重试"; return; }
        durationMs.value = Math.min(Date.now() - began, STORY_LIMITS.voiceSeconds * 1000);
        file.value = new File([blob], current.mimeType.includes("mp4") ? "story.m4a" : "story.webm", { type: current.mimeType });
        preview.value = URL.createObjectURL(blob);
        if (outcome.reason === "interrupted") error.value = "录音被中断，请试听已保留的部分";
      };
      current.onerror = () => { error.value = "录音遇到问题，请检查保留的内容"; };
      currentSession.start(current);
      recording.value = true;
      timer = setInterval(() => {
        durationMs.value = Date.now() - began;
        if (durationMs.value >= STORY_LIMITS.voiceSeconds * 1000) stop();
      }, 200);
      void wakeLock.acquire();
    } catch { if (ticket === version) { clear(); error.value = "无法录音，请允许麦克风权限后重试"; } }
    finally { if (ticket === version) starting.value = false; }
  }
  function visibility() { if (document.hidden && recording.value) stop(); }
  document.addEventListener("visibilitychange", visibility);
  onBeforeUnmount(() => { clear(); document.removeEventListener("visibilitychange", visibility); });
  return { file, preview, recording, starting, durationMs, error, start, stop, clear };
}
