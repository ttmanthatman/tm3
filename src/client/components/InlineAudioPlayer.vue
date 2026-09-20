<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { Download, Pause, Play } from "lucide-vue-next";
import type { MessageDTO } from "@shared/types";
import { compactBytes } from "../time";
import { resolveMessageWaveform } from "../audioWaveform";
import ResponsiveAudioWaveform from "./ResponsiveAudioWaveform.vue";
import { getSharedMessageAudioPlayback, type MessageAudioSnapshot } from "../features/audio/messageAudioPlayback";

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

// 播放实体由模块级控制器持有，虚拟列表把这一行卸载时只移除订阅，
// 不会销毁正在流式读取的 HTMLAudioElement。
const playbackController = getSharedMessageAudioPlayback();
const playback = ref<MessageAudioSnapshot>(playbackController.snapshot(props.message.id, payload.value.durationMs || 0));
const playing = computed(() => playback.value.playing);
const progress = computed(() => playback.value.progress);
const durationMs = computed(() => playback.value.durationMs || payload.value.durationMs || 0);
const elapsedMs = computed(() => Math.round(durationMs.value * progress.value));
const unsubscribe = playbackController.subscribe(
  props.message.id,
  props.src,
  payload.value.durationMs || 0,
  (snapshot) => { playback.value = snapshot; }
);

function toggle() {
  const wasPlaying = playing.value;
  void playbackController.toggle(props.message.id, props.src, payload.value.durationMs || 0);
  if (!wasPlaying) emit("play");
}

function seek(value: number) {
  const wasPlaying = playing.value;
  void playbackController.seek(props.message.id, props.src, value, payload.value.durationMs || 0);
  if (!wasPlaying) emit("play");
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

onBeforeUnmount(() => {
  unsubscribe();
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
