<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  COPYWORK_PAGE,
  copyworkCharacters,
  type CopyworkGlyph,
  type CopyworkPlacement,
  type CopyworkSource
} from "@shared/bibleCopywork";
import { copyworkInkViewport, copyworkPageHeight } from "./copyworkPageLayout";
import { createCopyworkPlaybackRenderer } from "./copyworkPlaybackRenderer";
import {
  buildHandwritingTimeline,
  type HandwritingTimeline
} from "../../handwriting/handwritingTimeline";
import { createHandwritingPlaybackController } from "../../handwriting/useHandwritingPlayback";
import { createCopyworkGestures } from "./copyworkGestures";
import { openCopyworkSource } from "./copyworkViewerState";
const props = withDefaults(
  defineProps<{
    glyphs: Array<CopyworkGlyph & { index: number }>;
    placements: CopyworkPlacement[];
    source: CopyworkSource;
    author?: string;
    date?: string;
    editable?: boolean;
    active?: boolean;
    compact?: boolean;
    interactive?: boolean;
    paging?: boolean;
    disabled?: boolean;
  }>(),
  { active: true }
);
const emit = defineEmits<{ edit: [index: number]; turn: [direction: -1 | 1] }>();
const canvas = ref<HTMLCanvasElement | null>(null);
const root = ref<HTMLElement | null>(null);
const playing = ref(false);
const progress = ref(1);
const sourceError = ref("");
let resizeObserver: ResizeObserver | null = null;
let replayStarted = false;
let timeline: HandwritingTimeline | null = null;
let cursor = 0;
let renderedProgress = -1;
let counts = new Map<number, number[]>();
const pageHeight = computed(() => copyworkPageHeight(props.glyphs, props.placements));
const viewport = computed(() =>
  props.compact
    ? copyworkInkViewport(props.glyphs, props.placements)
    : { x: 0, y: 0, width: COPYWORK_PAGE.width, height: pageHeight.value }
);
const paperStyle = computed(() => ({
  aspectRatio: `${viewport.value.width} / ${viewport.value.height}`,
  "--folio-heading-top": `${(48 / pageHeight.value) * 100}%`,
  "--folio-caption-bottom": `${(38 / pageHeight.value) * 100}%`
}));
const characters = computed(() => copyworkCharacters(props.source.text));
const glyphMap = computed(() => new Map(props.glyphs.map((g) => [g.index, g])));
const orderedGlyphs = computed(() =>
  props.placements
    .map((p) => glyphMap.value.get(p.index))
    .filter((g): g is CopyworkGlyph & { index: number } => !!g)
);
function payload() {
  return {
    kind: "handwriting" as const,
    version: 1 as const,
    characters: orderedGlyphs.value.map((g) => g.character)
  };
}
const renderer = createCopyworkPlaybackRenderer({
  canvas: () => canvas.value,
  viewport: () => viewport.value,
  glyphs: () => props.glyphs,
  placements: () => props.placements,
  active: () => renderActive && props.active && !document.hidden
});
let renderActive = false;
function draw(visibleCounts?: Map<number, number[]>) { renderer.draw(visibleCounts); }
function drawProgress(elapsed: number) {
  replayStarted = true;
  timeline ||= buildHandwritingTimeline(payload());
  if (elapsed < renderedProgress) {
    counts = new Map();
    cursor = 0;
  }
  while (cursor < timeline.events.length && timeline.events[cursor].at <= elapsed) {
    const event = timeline.events[cursor++];
    const glyph = orderedGlyphs.value[event.characterIndex];
    const values = counts.get(glyph.index) || glyph.character.strokes.map(() => 0);
    values[event.strokeIndex] = event.pointIndex + 1;
    counts.set(glyph.index, values);
  }
  renderedProgress = elapsed;
  progress.value = timeline.durationMs ? elapsed / timeline.durationMs : 1;
  draw(counts);
}
const controller = createHandwritingPlaybackController({
  getPayload: payload,
  draw: drawProgress,
  onStateChange: (state) => {
    playing.value = state.playing;
    const wasActive = renderActive;
    renderActive = state.visible && state.surfaceActive && !document.hidden;
    if (!renderActive) renderer.cancel();
    else if (!wasActive) draw(replayStarted ? counts : undefined);
    if (!state.visible || !state.surfaceActive || document.hidden) gestures.cancel();
  }
});
function play() {
  controller.play(true);
}
function toggle() {
  if (props.disabled) return;
  if (playing.value) controller.pause();
  else controller.play(!replayStarted || progress.value >= 1);
}
function stop() {
  controller.pause();
  gestures.cancel();
  replayStarted = false;
  progress.value = 1;
  counts = new Map();
  cursor = 0;
  renderedProgress = -1;
  draw();
}
const gestures = createCopyworkGestures({
  paging: () => !!props.paging,
  playing: () => playing.value,
  progress: () => (replayStarted ? controller.state().progressMs : controller.duration()),
  duration: controller.duration,
  toggle,
  restart: play,
  pause: controller.pause,
  resume: () => controller.play(false),
  seek: (elapsed) => {
    controller.seek(elapsed);
  },
  turn: (direction) => emit("turn", direction)
});
function contact(event: PointerEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  return {
    id: event.pointerId,
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    width: rect.width
  };
}
function pointerDown(event: PointerEvent) {
  if (!props.interactive || props.disabled || event.button !== 0 || !event.isPrimary) return;
  gestures.down(contact(event));
  const element = event.currentTarget as HTMLElement;
  if (event.isTrusted) element.setPointerCapture(event.pointerId);
}
function pointerMove(event: PointerEvent) {
  if (!props.interactive || props.disabled) return;
  if (gestures.move(contact(event))) {
    event.preventDefault();
    const element = event.currentTarget as HTMLElement;
    if (event.isTrusted && !element.hasPointerCapture(event.pointerId)) element.setPointerCapture(event.pointerId);
  }
}
function pointerUp(event: PointerEvent) {
  if (!props.interactive || props.disabled) return;
  gestures.up(contact(event));
}
function pointerLeave(event: PointerEvent) {
  if (!(event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) gestures.lostCapture();
}
function keydown(event: KeyboardEvent) {
  if (!props.interactive || props.disabled) return;
  if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    toggle();
  }
  if (props.paging && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
    event.preventDefault();
    emit("turn", event.key === "ArrowLeft" ? -1 : 1);
  }
}
async function openSource() {
  sourceError.value = "";
  controller.pause();
  gestures.cancel();
  try {
    await openCopyworkSource(props.source);
  } catch (error) {
    sourceError.value = error instanceof Error ? error.message : "经文跳转失败";
  }
}
function editStyle(p: CopyworkPlacement) {
  const b = glyphMap.value.get(p.index)?.bounds;
  const scale = COPYWORK_PAGE.font / 10000;
  return {
    left: `${(p.x + (b?.left || 0) * scale) / (COPYWORK_PAGE.width / 100)}%`,
    top: `${(p.y + (b?.top || 0) * scale) / (pageHeight.value / 100)}%`,
    width: `${Math.max(20, ((b?.right || 10000) - (b?.left || 0)) * scale) / (COPYWORK_PAGE.width / 100)}%`,
    height: `${Math.max(30, ((b?.bottom || 10000) - (b?.top || 0)) * scale) / (pageHeight.value / 100)}%`
  };
}
watch(
  () => [props.glyphs, props.placements, props.compact],
  () => {
    renderer.reset();
    timeline = null;
    controller.setPayload();
    stop();
    void nextTick(() => draw());
  }
);
watch(
  () => props.active,
  (active) => {
    controller.setSurfaceActive(active);
    if (!active) gestures.cancel();
  }
);
onMounted(() => {
  controller.mount(root.value!.closest(".message-row") || root.value!);
  controller.setSurfaceActive(props.active);
  resizeObserver = new ResizeObserver(() => draw(replayStarted ? counts : undefined));
  if (canvas.value) resizeObserver.observe(canvas.value);
  draw();
});
onBeforeUnmount(() => {
  gestures.cancel();
  controller.destroy();
  renderer.destroy();
  resizeObserver?.disconnect();
});
defineExpose({ play, stop, playing });
</script>
<template>
  <figure ref="root" class="copywork-mount" :class="{ compact }" aria-label="经文抄写册页">
    <button
      v-if="compact"
      class="copywork-reference"
      type="button"
      :aria-label="`在圣经中阅读：${source.reference}`"
      @pointerdown.stop
      @click.stop="openSource"
    >
      {{ source.reference }}
    </button>
    <div
      class="copywork-paper"
      :class="{ interactive }"
      :style="paperStyle"
      :role="interactive ? 'button' : undefined"
      :tabindex="interactive ? 0 : undefined"
      :aria-label="
        interactive ? `${playing ? '暂停' : '播放'}抄写：${source.reference}` : undefined
      "
      :aria-disabled="interactive ? !!disabled : undefined"
      :aria-pressed="interactive ? playing : undefined"
      :data-playing="playing"
      :data-progress="progress"
      :data-bible-swipe-interaction="interactive ? 'copywork-playback' : undefined"
      @pointerdown.stop="pointerDown"
      @pointermove.stop="pointerMove"
      @pointerup.stop="pointerUp"
      @pointercancel.stop="gestures.cancel()"
      @pointerleave="pointerLeave"
      @lostpointercapture="gestures.lostCapture()"
      @contextmenu.prevent.stop
      @dblclick.prevent.stop
      @click="interactive && $event.stopPropagation()"
      @keydown.stop="keydown"
    >
      <div v-if="!compact" class="folio-heading">{{ source.reference }}</div>
      <canvas ref="canvas" aria-label="用户手写笔迹"></canvas>
      <template v-if="editable"
        ><button
          v-for="p in placements"
          :key="p.index"
          class="ink-edit"
          :style="editStyle(p)"
          :aria-label="`重写第 ${p.index + 1} 字：${characters[p.index]}`"
          @click="emit('edit', p.index)"
        ></button
      ></template>
      <div v-if="!compact" class="folio-caption">
        <span>{{ source.translationName }}</span
        ><span
          >{{ author || "我的抄写"
          }}<template v-if="date">
            · {{ new Date(date).toLocaleDateString("zh-CN") }}</template
          ></span
        >
      </div>
    </div>
    <p v-if="sourceError" class="source-error" role="alert">{{ sourceError }}</p>
  </figure>
</template>
<style scoped>
.copywork-mount {
  margin: 0;
  padding: 4.5%;
  background: #e8dfcd;
  border: 1px solid #cfc2a8;
  box-shadow: 0 12px 32px #59422c15;
}
.copywork-paper {
  position: relative;
  background: #fffaf0;
  border: 1px solid #dfd3bf;
  color: #756652;
}
canvas {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
}
.folio-heading {
  position: absolute;
  top: var(--folio-heading-top);
  left: 9.4%;
  font-family: "Songti SC", serif;
  font-size: clamp(10px, 1.4vw, 16px);
  letter-spacing: 0.12em;
}
.folio-caption {
  position: absolute;
  bottom: var(--folio-caption-bottom);
  left: 9.4%;
  right: 9.4%;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: clamp(9px, 1.2vw, 13px);
}
.ink-edit {
  position: absolute;
  background: transparent;
  border: 0;
  cursor: pointer;
  padding: 0;
}
.ink-edit:hover,
.ink-edit:focus-visible {
  outline: 1px solid #998269;
  background: #987a4510;
}
.copywork-mount.compact {
  padding: 0;
  background: transparent;
  border: 0;
  box-shadow: none;
}
.compact .copywork-paper {
  background: transparent;
  border: 0;
}
.copywork-reference {
  display: block;
  width: fit-content;
  margin: 0 0 8px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--copywork-reference-color, #315b4e);
  text-decoration: underline;
  text-underline-offset: 3px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.interactive {
  cursor: pointer;
  touch-action: pan-y;
  user-select: none;
  -webkit-user-select: none;
}
.interactive:focus-visible,
.copywork-reference:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
.source-error {
  color: #9b4130;
  font-size: 13px;
}
</style>
