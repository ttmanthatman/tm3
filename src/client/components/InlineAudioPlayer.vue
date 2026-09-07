<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { Download, Pause, Play } from "lucide-vue-next";
import type { MessageDTO } from "@shared/types";
import { compactBytes } from "../time";
import { resolveMessageWaveform } from "../audioWaveform";
import ResponsiveAudioWaveform from "./ResponsiveAudioWaveform.vue";
import { getSharedExclusiveAudio, registerMessageAudioStop } from "../features/audio/messageAudioPlayback";

type VoicePayload = {
  kind?: string;
  durationMs?: number;
  waveform?: number[];
  mimeType?: string;
};

const props = defineProps<{
  message: MessageDTO;
  src: string;
  unread?: boolean;
}>();

const emit = defineEmits<{
  play: [];
  download: [event: MouseEvent];
}>();

const payload = computed(() => {
  const value = props.message.payload as VoicePayload | undefined;
  return value?.kind === "voice" || value?.kind === "audio" ? value : {};
});
const isVoice = computed(() => payload.value.kind === "voice");
const waveform = computed(() => resolveMessageWaveform(payload.value.waveform, props.message.id));

const exclusiveAudio = getSharedExclusiveAudio();
const participantId = `voice:message-${props.message.id}`;
// 每个播放器实例独占一条消息的播放状态；timeupdate 的 ~4Hz 进度更新只触发
// 本组件重渲染，不再冒泡到消息列表根部。
const playing = ref(false);
const progress = ref(0);
const loadedDurationMs = ref(0);
const durationMs = computed(() => loadedDurationMs.value || payload.value.durationMs || 0);
const elapsedMs = computed(() => Math.round(durationMs.value * progress.value));
let audio: HTMLAudioElement | null = null;

function setProgress(value: number) {
  progress.value = Math.min(1, Math.max(0, value));
}

function ensureAudio() {
  if (audio) return audio;
  const element = new Audio(props.src);
  element.preload = "metadata";
  element.setAttribute("playsinline", "true");
  element.setAttribute("webkit-playsinline", "true");
  element.addEventListener("loadedmetadata", () => {
    if (Number.isFinite(element.duration) && element.duration > 0) loadedDurationMs.value = Math.round(element.duration * 1000);
  });
  element.addEventListener("timeupdate", () => {
    if (element.duration) setProgress(element.currentTime / element.duration);
  });
  element.addEventListener("ended", () => {
    setProgress(1);
    playing.value = false;
    exclusiveAudio.deactivate(participantId, { resumeSuspended: true });
  });
  element.addEventListener("pause", () => {
    if (element.ended) return;
    playing.value = false;
    exclusiveAudio.deactivate(participantId);
  });
  audio = element;
  return element;
}

function stopPlayback() {
  if (!audio) return;
  audio.pause();
  audio.currentTime = 0;
  setProgress(0);
}

function toggle() {
  const element = ensureAudio();
  if (playing.value) {
    element.pause();
    return;
  }
  if (element.ended) {
    element.currentTime = 0;
    setProgress(0);
  }
  playing.value = true;
  exclusiveAudio.activate(participantId);
  const playAttempt = element.play();
  emit("play");
  playAttempt.catch(() => {
    playing.value = false;
  });
}

function seek(value: number) {
  const element = ensureAudio();
  const duration = Number.isFinite(element.duration) ? element.duration : durationMs.value / 1000;
  if (!duration) return;
  const normalized = Math.min(1, Math.max(0, value));
  element.currentTime = duration * normalized;
  setProgress(normalized);
  if (element.paused) toggle();
}

function voiceBarStyle(bar: number, index: number, total: number, value: number) {
  return {
    height: `${Math.round(7 + bar * 25)}px`,
    opacity: index / Math.max(1, total) <= value ? 1 : 0.52
  };
}

function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

exclusiveAudio.register({ id: participantId, resumable: false, suspend: stopPlayback, resume: () => undefined });
const unregisterStop = registerMessageAudioStop(stopPlayback);

onBeforeUnmount(() => {
  unregisterStop();
  stopPlayback();
  exclusiveAudio.unregister(participantId);
  if (audio) audio.src = "";
});
</script>

<template>
  <div v-if="isVoice" class="voice-card" :class="{ playing, unread }" @click.stop>
    <button class="voice-play" @click="toggle" :aria-label="playing ? '暂停语音' : '播放语音'">
      <Pause v-if="playing" :size="20" />
      <Play v-else :size="20" />
    </button>
    <button class="voice-waveform" @click="toggle" aria-label="播放语音波形">
      <span
        v-for="(bar, idx) in waveform"
        :key="idx"
        class="voice-bar"
        :class="{ active: idx / waveform.length <= progress }"
        :style="voiceBarStyle(bar, idx, waveform.length, progress)"
      ></span>
    </button>
    <div class="voice-meta">
      <span>{{ formatDuration(durationMs) }}</span>
      <small>{{ compactBytes(message.fileSize) }}</small>
    </div>
    <span v-if="unread" class="voice-unread-dot" aria-label="未收听"></span>
  </div>
  <div
    v-else
    class="inline-audio-player"
    :class="{ playing }"
    role="group"
    :aria-label="`${message.fileName || '音频'}播放器`"
    @click.stop
  >
    <div class="inline-audio-head">
      <span class="inline-audio-title">
        <strong :title="message.fileName || '音频'">{{ message.fileName || "音频" }}</strong>
        <small>音频 · {{ compactBytes(message.fileSize) }}<template v-if="message.lyrics"> · 带歌词</template></small>
      </span>
      <span class="inline-audio-actions">
        <button type="button" @click="emit('download', $event)" aria-label="下载音频" title="下载音频"><Download :size="15" /></button>
      </span>
    </div>
    <div class="inline-audio-controls">
      <button
        type="button"
        class="inline-audio-play"
        @click="toggle"
        :aria-label="playing ? '暂停音频' : '播放音频'"
      >
        <Pause v-if="playing" :size="21" />
        <Play v-else :size="21" />
      </button>
      <ResponsiveAudioWaveform :samples="waveform" :progress="progress" @seek="seek" />
    </div>
    <div class="inline-audio-time">
      <span>{{ formatDuration(elapsedMs) }}</span>
      <span>{{ formatDuration(durationMs) }}</span>
    </div>
  </div>
</template>
