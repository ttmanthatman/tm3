<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Pause, Play, RotateCcw } from "lucide-vue-next";
import { parseStoredHandwritingPayload, type HandwritingCharacter, type HandwritingPayload } from "@shared/handwriting";
import type { MessageDTO } from "@shared/types";
import { drawHandwritingCharacter } from "./handwritingRenderer";
import { buildHandwritingTimeline, type HandwritingTimeline } from "./handwritingTimeline";
import {
  createHandwritingPlaybackController,
  handwritingGridMetrics,
  type HandwritingPlaybackState
} from "./useHandwritingPlayback";

const props = withDefaults(defineProps<{
  message: MessageDTO;
  variant: "timeline" | "favorite";
  surfaceActive?: boolean;
  claimAutoPlay?: () => boolean;
}>(), { surfaceActive: true });

const root = ref<HTMLElement | null>(null);
const grid = ref<HTMLElement | null>(null);
const playbackState = ref<HandwritingPlaybackState>({ playing: false, progressMs: 0, visible: false, surfaceActive: true });
const payload = ref<HandwritingPayload | null>(parseStoredHandwritingPayload(props.message.payload));
const viewportWidth = ref(typeof window === "undefined" ? 1280 : window.innerWidth);
const metrics = computed(() => handwritingGridMetrics(payload.value, viewportWidth.value));
const gridStyle = computed(() => ({ "--handwriting-columns": metrics.value.columns, "--handwriting-rows": metrics.value.rows }));
let timeline: HandwritingTimeline = { events: [], durationMs: 0 };
let timelineCursor = 0;
let renderedProgress = 0;
let visiblePointCounts = new Map<string, number>();
let resizeObserver: ResizeObserver | null = null;

function partialCharacter(index: number): HandwritingCharacter | null {
  const character = payload.value?.characters[index];
  if (!character) return null;
  const strokes = character.strokes.flatMap((stroke, strokeIndex) => {
    const count = visiblePointCounts.get(`${index}:${strokeIndex}`) || 0;
    return count > 0 ? [{ points: stroke.points.slice(0, count) }] : [];
  });
  return strokes.length ? { strokes } : null;
}

function canvases() {
  return [...(grid.value?.querySelectorAll<HTMLCanvasElement>("canvas") || [])];
}

function drawCurrent() {
  const elements = canvases();
  payload.value?.characters.forEach((_character, index) => {
    const canvas = elements[index];
    if (canvas) drawHandwritingCharacter(canvas, partialCharacter(index));
  });
}

function resetProgress() {
  timelineCursor = 0;
  renderedProgress = 0;
  visiblePointCounts = new Map();
}

function draw(progressMs: number) {
  if (!payload.value) return;
  if (progressMs < renderedProgress) resetProgress();
  while (timelineCursor < timeline.events.length && timeline.events[timelineCursor].at <= progressMs) {
    const event = timeline.events[timelineCursor];
    const key = `${event.characterIndex}:${event.strokeIndex}`;
    visiblePointCounts.set(key, (visiblePointCounts.get(key) || 0) + 1);
    timelineCursor += 1;
  }
  renderedProgress = progressMs;
  drawCurrent();
}

function renderStatic() {
  resetProgress();
  const elements = canvases();
  payload.value?.characters.forEach((character, index) => {
    const canvas = elements[index];
    if (canvas) drawHandwritingCharacter(canvas, character);
  });
}

function rebuild() {
  payload.value = parseStoredHandwritingPayload(props.message.payload);
  timeline = payload.value ? buildHandwritingTimeline(payload.value) : { events: [], durationMs: 0 };
  controller.setPayload();
  void nextTick(renderStatic);
}

const controller = createHandwritingPlaybackController({
  getPayload: () => payload.value,
  draw,
  claimAutoPlay: () => props.variant === "timeline" && !!props.claimAutoPlay?.(),
  onStateChange: (state) => { playbackState.value = state; }
});

function togglePlayback() {
  if (playbackState.value.playing) {
    controller.pause(false);
    renderStatic();
    return;
  }
  controller.play(true);
}

watch(() => props.surfaceActive, (active) => controller.setSurfaceActive(active));
watch(() => props.message.payload, rebuild, { deep: true });
onMounted(() => {
  rebuild();
  if (root.value) controller.mount(root.value);
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      viewportWidth.value = window.innerWidth;
      if (playbackState.value.playing || playbackState.value.progressMs > 0) draw(playbackState.value.progressMs);
      else renderStatic();
    });
    if (root.value) resizeObserver.observe(root.value);
  }
});
onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  controller.destroy();
});
</script>

<template>
  <div ref="root" class="handwriting-message" :class="{ damaged: !payload }">
    <template v-if="payload">
      <header class="handwriting-message-head">
        <strong>手写消息 · {{ payload.characters.length }} 字</strong>
        <button
          type="button"
          class="handwriting-message-replay"
          :aria-label="playbackState.playing ? '暂停手写消息播放' : '重播手写消息'"
          :title="playbackState.playing ? '暂停播放' : '重播'"
          @pointerdown.stop
          @click.stop="togglePlayback"
        >
          <Pause v-if="playbackState.playing" :size="15" />
          <RotateCcw v-else :size="15" />
          <span>{{ playbackState.playing ? "暂停" : "重播" }}</span>
        </button>
      </header>
      <div
        ref="grid"
        class="handwriting-message-grid"
        :style="gridStyle"
        role="img"
        :aria-label="`手写消息，共 ${payload.characters.length} 字`"
      >
        <div v-for="index in payload.characters.length" :key="index" class="handwriting-message-cell"><canvas aria-hidden="true"></canvas></div>
      </div>
    </template>
    <p v-else class="handwriting-message-broken" role="alert">手写消息暂无法显示</p>
  </div>
</template>

<style scoped>
.handwriting-message {
  width: fit-content;
  max-width: 100%;
  color: #294737;
  user-select: none;
  -webkit-user-select: none;
}

.handwriting-message-head {
  min-height: 30px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 7px;
  font-size: 12px;
}

.handwriting-message-replay {
  min-height: 30px;
  border: 1px solid #d4dfd4;
  border-radius: 7px;
  background: #fff;
  color: #355c48;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 9px;
}

.handwriting-message-grid {
  --handwriting-columns: 6;
  --handwriting-rows: 1;
  display: grid;
  grid-template-columns: repeat(var(--handwriting-columns), minmax(0, 1fr));
  grid-template-rows: repeat(var(--handwriting-rows), minmax(0, 1fr));
  width: min(360px, calc(var(--handwriting-columns) * 54px), 100%);
  aspect-ratio: var(--handwriting-columns) / var(--handwriting-rows);
  margin-inline: auto;
  background: #fff;
  border: 1px solid #e1e7de;
}

.handwriting-message-cell {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-right: 1px solid #edf0eb;
  border-bottom: 1px solid #edf0eb;
}

.handwriting-message-cell canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.handwriting-message-broken {
  min-height: 72px;
  display: grid;
  place-items: center;
  margin: 0;
  border: 1px dashed #d6ddd3;
  color: #8a5a53;
  background: #fff;
  font-size: 12px;
}
</style>
