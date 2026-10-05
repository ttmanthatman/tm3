<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { parseStoredHandwritingPayload, type HandwritingPayload } from "@shared/handwriting";
import type { MessageDTO } from "@shared/types";
import { drawHandwritingCharacter, drawHandwritingCharacterSteps } from "./handwritingRenderer";
import { buildHandwritingTimeline, type HandwritingTimeline } from "./handwritingTimeline";
import { handwritingRenderQueue } from "./handwritingRenderQueue";
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
// Stored DTOs replace their payload as a whole. Keep their thousands of points
// out of Vue's deep proxy/dependency traversal during each canvas draw.
const payload = shallowRef<HandwritingPayload | null>(parseStoredHandwritingPayload(props.message.payload));
const viewportWidth = ref(typeof window === "undefined" ? 1280 : window.innerWidth);
const metrics = computed(() => handwritingGridMetrics(payload.value, viewportWidth.value));
const gridStyle = computed(() => ({ "--handwriting-columns": metrics.value.columns, "--handwriting-rows": metrics.value.rows }));
const paperStyle = computed(() => payload.value?.paper
  ? { backgroundColor: payload.value.paper.color, padding: "8px", borderRadius: "10px" }
  : {});
let timeline: HandwritingTimeline | null = null;
let timelineCursor = 0;
let renderedProgress = 0;
let visiblePointCounts = new Map<string, number>();
let resizeObserver: ResizeObserver | null = null;
let desiredStatic = true;
let mounted = false;
let resizeScheduled = false;
let lastGridSize = "";
const renderedCharacters = new Map<HTMLCanvasElement, string>();
const pendingCanvases = new Set<HTMLCanvasElement>();
const pendingSignatures = new Map<HTMLCanvasElement, string>();

function canvases() {
  return [...(grid.value?.querySelectorAll<HTMLCanvasElement>("canvas") || [])];
}

function canRender() {
  return mounted && playbackState.value.visible && props.surfaceActive && document.visibilityState === "visible";
}

function cancelPendingRenders() {
  for (const canvas of pendingCanvases) handwritingRenderQueue.cancel(canvas);
  pendingCanvases.clear();
  pendingSignatures.clear();
}

function gridSize() {
  const rect = grid.value?.getBoundingClientRect();
  return `${rect?.width || 0}:${rect?.height || 0}:${window.devicePixelRatio}`;
}

function drawCurrent() {
  if (!canRender()) return;
  if (!lastGridSize) lastGridSize = gridSize();
  const elements = canvases();
  payload.value?.characters.forEach((character, index) => {
    const canvas = elements[index];
    if (!canvas) return;
    const options = {
      glow: payload.value?.glow,
      ...(desiredStatic ? {} : {
        visiblePointCounts: character.strokes.map((_stroke, strokeIndex) => visiblePointCounts.get(`${index}:${strokeIndex}`) || 0)
      })
    };
    const pointCounts = options.visiblePointCounts;
    const signature = !pointCounts || pointCounts.every((count, i) => count === character.strokes[i].points.length)
      ? "static" : pointCounts.join(",");
    if (renderedCharacters.get(canvas) === signature) {
      handwritingRenderQueue.cancel(canvas);
      pendingCanvases.delete(canvas);
      pendingSignatures.delete(canvas);
      return;
    }
    if (pendingSignatures.get(canvas) === signature) return;
    pendingCanvases.add(canvas);
    pendingSignatures.set(canvas, signature);
    const drawing = signature === "static" ? drawHandwritingCharacterSteps(canvas, character, options) : null;
    const render = () => {
      if (!canRender() || !canvas.isConnected || !grid.value?.contains(canvas)) {
        pendingCanvases.delete(canvas);
        pendingSignatures.delete(canvas);
        return;
      }
      // A yielded draw has already changed pixels, so its previous completed
      // signature cannot be reused if playback or visibility interrupts it.
      renderedCharacters.delete(canvas);
      if (drawing && !drawing.next().done) {
        handwritingRenderQueue.enqueue(canvas, render);
        return;
      }
      if (!drawing) drawHandwritingCharacter(canvas, character, { ...options });
      pendingCanvases.delete(canvas);
      pendingSignatures.delete(canvas);
      renderedCharacters.set(canvas, signature);
    };
    handwritingRenderQueue.enqueue(canvas, render);
  });
}

function resetProgress() {
  timelineCursor = 0;
  renderedProgress = 0;
  visiblePointCounts = new Map();
}

function draw(progressMs: number) {
  if (!payload.value) return;
  desiredStatic = false;
  if (progressMs < renderedProgress) resetProgress();
  if (progressMs > 0 && !timeline) timeline = buildHandwritingTimeline(payload.value);
  while (timeline && timelineCursor < timeline.events.length && timeline.events[timelineCursor].at <= progressMs) {
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
  desiredStatic = true;
  drawCurrent();
}

function rebuild() {
  cancelPendingRenders();
  renderedCharacters.clear();
  resetProgress();
  desiredStatic = true;
  lastGridSize = "";
  payload.value = parseStoredHandwritingPayload(props.message.payload);
  timeline = null;
  controller.setPayload();
  void nextTick(drawCurrent);
}

const controller = createHandwritingPlaybackController({
  getPayload: () => payload.value,
  draw,
  claimAutoPlay: () => props.variant === "timeline" && !!props.claimAutoPlay?.(),
  onAutoPlayDeclined: renderStatic,
  onStateChange: (state) => {
    playbackState.value = state;
    if (canRender()) drawCurrent();
    else cancelPendingRenders();
  }
});

function replayHandwriting() {
  controller.play(true);
}

function handleReplayKey(event: KeyboardEvent) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  event.stopPropagation();
  replayHandwriting();
}

function handleResize() {
  viewportWidth.value = window.innerWidth;
  if (resizeScheduled) return;
  resizeScheduled = true;
  void nextTick(() => {
    resizeScheduled = false;
    if (!mounted) return;
    const size = gridSize();
    if (size === lastGridSize) return;
    lastGridSize = size;
    cancelPendingRenders();
    renderedCharacters.clear();
    drawCurrent();
  });
}

watch(() => props.surfaceActive, (active) => controller.setSurfaceActive(active));
watch(() => props.message.payload, rebuild);
onMounted(() => {
  mounted = true;
  controller.setSurfaceActive(props.surfaceActive);
  if (root.value) controller.mount(root.value.closest(".message-row") || root.value);
  window.addEventListener("resize", handleResize, { passive: true });
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(handleResize);
    if (grid.value) resizeObserver.observe(grid.value);
  }
});
onBeforeUnmount(() => {
  mounted = false;
  window.removeEventListener("resize", handleResize);
  cancelPendingRenders();
  renderedCharacters.clear();
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
