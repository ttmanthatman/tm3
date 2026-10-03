<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  COPYWORK_PAGE,
  copyworkCharacters,
  type CopyworkGlyph,
  type CopyworkPlacement,
  type CopyworkSource
} from "@shared/bibleCopywork";
import { drawHandwritingInk } from "../../handwriting/handwritingRenderer";
import { buildHandwritingTimeline } from "../../handwriting/handwritingTimeline";
const props = defineProps<{
  glyphs: Array<CopyworkGlyph & { index: number }>;
  placements: CopyworkPlacement[];
  source: CopyworkSource;
  author?: string;
  date?: string;
  editable?: boolean;
  active?: boolean;
}>();
const emit = defineEmits<{ edit: [index: number] }>();
const canvas = ref<HTMLCanvasElement | null>(null);
const root = ref<HTMLElement | null>(null);
const playing = ref(false);
let frame = 0;
let observer: IntersectionObserver | null = null;
let resizeObserver: ResizeObserver | null = null;
const characters = computed(() => copyworkCharacters(props.source.text));
const glyphMap = computed(() => new Map(props.glyphs.map((g) => [g.index, g])));
function draw(counts?: Map<number, number[]>) {
  const ctx = canvas.value?.getContext("2d");
  if (!ctx || !canvas.value) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(canvas.value.getBoundingClientRect().width * ratio));
  const height = Math.round((width * COPYWORK_PAGE.height) / COPYWORK_PAGE.width);
  if (canvas.value.width !== width || canvas.value.height !== height) {
    canvas.value.width = width;
    canvas.value.height = height;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.scale(width / COPYWORK_PAGE.width, height / COPYWORK_PAGE.height);
  for (const p of props.placements) {
    const glyph = glyphMap.value.get(p.index);
    if (!glyph) continue;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(COPYWORK_PAGE.font / 10000, COPYWORK_PAGE.font / 10000);
    drawHandwritingInk(
      ctx,
      glyph.character,
      counts ? counts.get(p.index) || glyph.character.strokes.map(() => 0) : undefined
    );
    ctx.restore();
  }
}
function stop() {
  cancelAnimationFrame(frame);
  frame = 0;
  playing.value = false;
  draw();
}
function play() {
  stop();
  const glyphs = props.placements
    .map((p) => glyphMap.value.get(p.index))
    .filter((g): g is CopyworkGlyph & { index: number } => !!g);
  const timeline = buildHandwritingTimeline({
    kind: "handwriting",
    version: 1,
    characters: glyphs.map((g) => g.character)
  });
  let cursor = 0;
  const counts = new Map<number, number[]>();
  const start = performance.now();
  playing.value = true;
  function tick(now: number) {
    while (cursor < timeline.events.length && timeline.events[cursor].at <= now - start) {
      const event = timeline.events[cursor++];
      const glyph = glyphs[event.characterIndex];
      const values = counts.get(glyph.index) || glyph.character.strokes.map(() => 0);
      values[event.strokeIndex] = event.pointIndex + 1;
      counts.set(glyph.index, values);
    }
    draw(counts);
    if (cursor < timeline.events.length) frame = requestAnimationFrame(tick);
    else {
      playing.value = false;
      frame = 0;
    }
  }
  frame = requestAnimationFrame(tick);
}
function visibility() {
  if (document.hidden) stop();
}
function editStyle(p: CopyworkPlacement) {
  const b = glyphMap.value.get(p.index)?.bounds;
  const scale = COPYWORK_PAGE.font / 10000;
  return {
    left: `${(p.x + (b?.left || 0) * scale) / 7.2}%`,
    top: `${(p.y + (b?.top || 0) * scale) / 9.6}%`,
    width: `${Math.max(20, ((b?.right || 10000) - (b?.left || 0)) * scale) / 7.2}%`,
    height: `${Math.max(30, ((b?.bottom || 10000) - (b?.top || 0)) * scale) / 9.6}%`
  };
}
watch(
  () => [props.glyphs, props.placements],
  () => {
    stop();
    void nextTick(() => draw());
  },
  { deep: true }
);
watch(
  () => props.active,
  (active) => {
    if (active === false) stop();
  }
);
onMounted(() => {
  resizeObserver = new ResizeObserver(() => {
    if (!playing.value) draw();
  });
  if (canvas.value) resizeObserver.observe(canvas.value);
  draw();
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", stop);
  observer = new IntersectionObserver((entries) => {
    if (!entries[0]?.isIntersecting) stop();
  });
  if (root.value) observer.observe(root.value);
});
onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  observer?.disconnect();
  resizeObserver?.disconnect();
  document.removeEventListener("visibilitychange", visibility);
  window.removeEventListener("pagehide", stop);
});
defineExpose({ play, stop, playing });
</script>
<template>
  <figure ref="root" class="copywork-mount" aria-label="经文抄写册页">
    <div class="copywork-paper">
      <div class="folio-heading">{{ source.reference }}</div>
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
      <div class="folio-caption">
        <span>{{ source.translationName }}</span
        ><span
          >{{ author || "我的抄写"
          }}<template v-if="date">
            · {{ new Date(date).toLocaleDateString("zh-CN") }}</template
          ></span
        >
      </div>
    </div>
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
  aspect-ratio: 3 / 4;
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
  top: 5%;
  left: 9.4%;
  font-family: "Songti SC", serif;
  font-size: clamp(10px, 1.4vw, 16px);
  letter-spacing: 0.12em;
}
.folio-caption {
  position: absolute;
  bottom: 4%;
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
</style>
