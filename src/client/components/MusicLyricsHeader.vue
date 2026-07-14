<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { MusicLyricCueDTO, MusicLyricSegmentDTO } from "@shared/types";
import { MUSIC_LYRICS_TICK_MS, shouldRunMusicLyricsClock } from "../animationPolicy";

const props = withDefaults(defineProps<{
  cues: MusicLyricCueDTO[];
  playing: boolean;
  suppressed?: boolean;
  getCurrentTimeMs: () => number;
}>(), {
  suppressed: false
});

defineEmits<{ hide: [] }>();

const currentTimeMs = ref(0);
const documentVisible = ref(document.visibilityState === "visible");
let clockTimer: number | undefined;

const currentIndex = computed(() => {
  if (!props.cues.length) return -1;
  let low = 0;
  let high = props.cues.length - 1;
  let result = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (props.cues[middle].startMs <= currentTimeMs.value) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
});
const currentCue = computed(() => props.cues[currentIndex.value] || null);
const nextCue = computed(() => props.cues[currentIndex.value + 1] || null);
const currentProgress = computed(() => cueProgress(currentCue.value));

function clockNeeded() {
  return shouldRunMusicLyricsClock({
    playing: props.playing,
    cueCount: props.cues.length,
    suppressed: props.suppressed,
    documentVisible: documentVisible.value
  });
}

function clearClock() {
  if (clockTimer !== undefined) window.clearTimeout(clockTimer);
  clockTimer = undefined;
}

function updateCurrentTime() {
  currentTimeMs.value = Math.max(0, Math.round(props.getCurrentTimeMs()));
}

function scheduleClock() {
  clearClock();
  if (!clockNeeded()) return;
  updateCurrentTime();
  clockTimer = window.setTimeout(runClock, MUSIC_LYRICS_TICK_MS);
}

function runClock() {
  clockTimer = undefined;
  if (!clockNeeded()) return;
  updateCurrentTime();
  clockTimer = window.setTimeout(runClock, MUSIC_LYRICS_TICK_MS);
}

function handleVisibilityChange() {
  documentVisible.value = document.visibilityState === "visible";
  scheduleClock();
}

function handlePageHide() {
  documentVisible.value = false;
  clearClock();
}

function handlePageShow() {
  documentVisible.value = document.visibilityState === "visible";
  scheduleClock();
}

function cueProgress(cue: MusicLyricCueDTO | MusicLyricSegmentDTO | null) {
  if (!cue) return 0;
  return Math.max(0, Math.min(100, ((currentTimeMs.value - cue.startMs) / Math.max(1, cue.endMs - cue.startMs)) * 100));
}

function lyricDisplayText(text?: string | null) {
  return String(text || "").replace(/\s*\n\s*/g, " ");
}

watch(() => [props.playing, props.cues, props.suppressed] as const, scheduleClock);

onMounted(() => {
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("pagehide", handlePageHide);
  window.addEventListener("pageshow", handlePageShow);
  scheduleClock();
});

onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  window.removeEventListener("pagehide", handlePageHide);
  window.removeEventListener("pageshow", handlePageShow);
  clearClock();
});
</script>

<template>
  <button type="button" class="music-lyrics-header" aria-label="隐藏歌词五秒" @click.stop="$emit('hide')">
    <span v-if="currentCue?.segments?.length" class="music-lyrics-current music-lyrics-current-enhanced">
      <span v-for="(segment, segmentIndex) in currentCue.segments" :key="`${segment.startMs}-${segmentIndex}`" class="music-lyrics-segment">
        <span class="music-lyrics-segment-base">{{ segment.text }}</span>
        <span class="music-lyrics-segment-fill" :style="{ clipPath: `inset(0 ${100 - cueProgress(segment)}% 0 0)` }">{{ segment.text }}</span>
      </span>
    </span>
    <span v-else class="music-lyrics-current">
      <span class="music-lyrics-current-base">{{ lyricDisplayText(currentCue?.text) }}</span>
      <span class="music-lyrics-current-fill" :style="{ clipPath: `inset(0 ${100 - currentProgress}% 0 0)` }">{{ lyricDisplayText(currentCue?.text) }}</span>
    </span>
    <span v-if="nextCue" class="music-lyrics-next">{{ lyricDisplayText(nextCue.text) }}</span>
  </button>
</template>
