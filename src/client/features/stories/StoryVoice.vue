<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { Pause, Play, AudioLines } from "lucide-vue-next";
import { getSharedExclusiveAudio } from "../audio/messageAudioPlayback";
const props = defineProps<{ src: string; durationMs?: number | null }>();
const audio = ref<HTMLAudioElement | null>(null);
const playing = ref(false);
const progress = ref(0);
const error = ref("");
const id = `story:${crypto.randomUUID()}`;
const coordinator = getSharedExclusiveAudio();
const pause = () => { audio.value?.pause(); playing.value = false; coordinator.deactivate(id); };
coordinator.register({ id, resumable: false, suspend: pause, resume: () => {} });
async function toggle() {
  if (!audio.value) return;
  if (playing.value) return pause();
  error.value = "";
  coordinator.activate(id);
  try { await audio.value.play(); playing.value = true; }
  catch { error.value = "语音暂时无法播放，请重试"; coordinator.deactivate(id); }
}
function time() {
  if (audio.value?.duration) progress.value = audio.value.currentTime / audio.value.duration;
}
function seek(event: Event) {
  if (audio.value && Number.isFinite(audio.value.duration)) audio.value.currentTime = Number((event.target as HTMLInputElement).value) * audio.value.duration;
}
function ended() { playing.value = false; progress.value = 0; coordinator.deactivate(id, { resumeSuspended: true }); }
const duration = () => {
  const seconds = Math.floor((props.durationMs || (audio.value?.duration || 0) * 1000) / 1000);
  return Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : "语音";
};
onBeforeUnmount(() => { pause(); coordinator.unregister(id); });
</script>

<template>
  <div class="story-voice-group">
    <div class="story-voice">
      <audio ref="audio" :src="src" preload="none" @timeupdate="time" @ended="ended" @error="error = '语音暂时无法播放，请重试'" />
      <button type="button" class="story-voice-play" :aria-label="playing ? '暂停故事语音' : '播放故事语音'" @click="toggle"><Pause v-if="playing" :size="20" /><Play v-else :size="20" /></button>
      <AudioLines :size="26" aria-hidden="true" />
      <input type="range" min="0" max="1" step="0.01" :value="progress" aria-label="故事语音进度" @input="seek" />
      <span>{{ duration() }}</span>
    </div>
    <p v-if="error" class="story-error" role="alert">{{ error }}</p>
  </div>
</template>
