<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
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
const paperStyle = computed(() => payload.value?.paper
  ? { backgroundColor: payload.value.paper.color, padding: "8px", borderRadius: "10px" }
  : {});
let timeline: HandwritingTimeline = { events: [], durationMs: 0 };
let timelineCursor = 0;
let renderedProgress = 0;
let visiblePointCounts = new Map<string, number>();
let resizeObserver: ResizeObserver | null = null;
let staticRendered = false;

function partialCharacter(index: number): HandwritingCharacter | null {
  const character = payload.value?.characters[index];
  if (!character) return null;
  const strokes = character.strokes.flatMap((stroke, strokeIndex) => {
    const count = visiblePointCounts.get(`${index}:${strokeIndex}`) || 0;
    return count > 0 ? [{ points: stroke.points.slice(0, count), ...(stroke.color ? { color: stroke.color } : {}) }] : [];
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
    if (canvas) drawHandwritingCharacter(canvas, partialCharacter(index), { glow: payload.value?.glow });
  });
}

function resetProgress() {
  timelineCursor = 0;
  renderedProgress = 0;
  visiblePointCounts = new Map();
}

function draw(progressMs: number) {
  if (!payload.value) return;
  staticRendered = false;
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
  staticRendered = true;
  const elements = canvases();
  payload.value?.characters.forEach((character, index) => {
    const canvas = elements[index];
    if (canvas) drawHandwritingCharacter(canvas, character, { glow: payload.value?.glow });
  });
}

function rebuild() {
  const restoreStatic = staticRendered && !playbackState.value.playing;
  staticRendered = false;
  payload.value = parseStoredHandwritingPayload(props.message.payload);
  timeline = payload.value ? buildHandwritingTimeline(payload.value) : { events: [], durationMs: 0 };
  controller.setPayload();
  if (restoreStatic) void nextTick(renderStatic);
}

const controller = createHandwritingPlaybackController({
  getPayload: () => payload.value,
  draw,
  claimAutoPlay: () => props.variant === "timeline" && !!props.claimAutoPlay?.(),
  onAutoPlayDeclined: renderStatic,
  onStateChange: (state) => { playbackState.value = state; }
});

function replayHandwriting() {
  staticRendered = false;
  controller.play(true);
}

function handleReplayKey(event: KeyboardEvent) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  event.stopPropagation();
  replayHandwriting();
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
      else if (staticRendered) renderStatic();
      else draw(playbackState.value.progressMs);
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
  <div
    ref="root"
    class="handwriting-message"
    :class="{ damaged: !payload, 'has-paper': !!payload?.paper }"
    :style="paperStyle"
    :role="payload ? 'button' : undefined"
    :tabindex="payload ? 0 : undefined"
    :aria-label="payload ? `手写消息，共 ${payload.characters.length} 字，点击重新播放` : undefined"
    @click.stop="payload && replayHandwriting()"
    @keydown="handleReplayKey"
  >
    <template v-if="payload">
      <div
        ref="grid"
        class="handwriting-message-grid"
        :style="gridStyle"
        aria-hidden="true"
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
  cursor: pointer;
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
  background: transparent;
}

.handwriting-message-cell {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
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
  background: transparent;
  font-size: 12px;
}
</style>
