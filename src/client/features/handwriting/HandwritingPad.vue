<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { HandwritingGlow, HandwritingStroke } from "@shared/handwriting";
import { appendHandwritingStroke, drawHandwritingCharacter } from "./handwritingRenderer";
import type { HandwritingInputPoint } from "./useHandwritingComposer";

const props = defineProps<{
  strokes: HandwritingStroke[];
  disabled?: boolean;
  ariaLabel?: string;
  backgroundColor?: string;
  glow?: HandwritingGlow | null;
}>();

const emit = defineEmits<{
  "stroke-start": [pointerId: number, point: HandwritingInputPoint];
  "stroke-point": [pointerId: number, point: HandwritingInputPoint];
  "stroke-end": [pointerId: number, point?: HandwritingInputPoint];
  "stroke-cancel": [pointerId: number];
}>();

const canvas = ref<HTMLCanvasElement | null>(null);
let activePointerId: number | null = null;
let resizeObserver: ResizeObserver | null = null;
let renderedPointCounts: number[] = [];
let renderedColors: Array<string | undefined> = [];
let renderedGlow = "";

function redraw() {
  if (!canvas.value) return;
  drawHandwritingCharacter(canvas.value, { strokes: props.strokes }, { glow: props.glow });
  renderedPointCounts = props.strokes.map((stroke) => stroke.points.length);
  renderedColors = props.strokes.map((stroke) => stroke.color);
  renderedGlow = JSON.stringify(props.glow || null);
}

function syncAppendedInk() {
  if (!canvas.value) return;
  const glowChanged = renderedGlow !== JSON.stringify(props.glow || null);
  const requiresRedraw = glowChanged || renderedPointCounts.length > props.strokes.length || props.strokes.some((stroke, index) => {
    const renderedCount = renderedPointCounts[index] || 0;
    return renderedCount > stroke.points.length || (renderedCount > 0 && renderedColors[index] !== stroke.color);
  });
  if (requiresRedraw) {
    redraw();
    return;
  }
  props.strokes.forEach((stroke, index) => {
    const renderedCount = renderedPointCounts[index] || 0;
    if (stroke.points.length > renderedCount) appendHandwritingStroke(canvas.value!, stroke, renderedCount, { glow: props.glow });
  });
  renderedPointCounts = props.strokes.map((stroke) => stroke.points.length);
  renderedColors = props.strokes.map((stroke) => stroke.color);
  renderedGlow = JSON.stringify(props.glow || null);
}

function inputPoint(event: PointerEvent): HandwritingInputPoint {
  const rect = canvas.value?.getBoundingClientRect();
  const width = rect?.width || 1;
  const height = rect?.height || 1;
  return {
    x: Math.max(0, Math.min(10_000, Math.round(((event.clientX - (rect?.left || 0)) / width) * 10_000))),
    y: Math.max(0, Math.min(10_000, Math.round(((event.clientY - (rect?.top || 0)) / height) * 10_000))),
    timestampMs: event.timeStamp
  };
}

function releasePointer(pointerId: number) {
  if (canvas.value?.hasPointerCapture(pointerId)) canvas.value.releasePointerCapture(pointerId);
}

function finish(event: PointerEvent) {
  if (activePointerId !== event.pointerId) return;
  const pointerId = event.pointerId;
  activePointerId = null;
  releasePointer(pointerId);
  emit("stroke-end", pointerId, inputPoint(event));
}

function cancel(pointerId: number) {
  if (activePointerId !== pointerId) return;
  activePointerId = null;
  releasePointer(pointerId);
  emit("stroke-cancel", pointerId);
}

function pointerDown(event: PointerEvent) {
  if (props.disabled || activePointerId !== null || (event.pointerType === "mouse" && event.button !== 0)) return;
  event.preventDefault();
  activePointerId = event.pointerId;
  canvas.value?.setPointerCapture?.(event.pointerId);
  emit("stroke-start", event.pointerId, inputPoint(event));
}

function pointerMove(event: PointerEvent) {
  if (props.disabled || activePointerId !== event.pointerId) return;
  const samples = event.getCoalescedEvents?.() || [];
  if (samples.length) {
    for (const sample of samples) emit("stroke-point", event.pointerId, inputPoint(sample));
  } else {
    emit("stroke-point", event.pointerId, inputPoint(event));
  }
}

function blur() {
  if (activePointerId !== null) cancel(activePointerId);
}

watch(() => props.strokes, redraw);
watch(() => props.strokes.map((stroke) => stroke.points.length), syncAppendedInk);
watch(() => props.glow, redraw, { deep: true });
watch(() => props.disabled, (disabled) => { if (disabled) blur(); });
onMounted(() => {
  redraw();
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(redraw);
    if (canvas.value) resizeObserver.observe(canvas.value);
  }
  window.addEventListener("blur", blur);
});
onBeforeUnmount(() => {
  blur();
  resizeObserver?.disconnect();
  resizeObserver = null;
  window.removeEventListener("blur", blur);
});
</script>

<template>
  <div class="handwriting-pad" :style="{ backgroundColor: backgroundColor || '#fff' }">
    <canvas
      ref="canvas"
      class="handwriting-pad-canvas"
      :aria-label="ariaLabel || '手写画板'"
      :aria-disabled="disabled || undefined"
      @pointerdown="pointerDown"
      @pointermove="pointerMove"
      @pointerup="finish"
      @pointercancel="cancel($event.pointerId)"
      @lostpointercapture="cancel($event.pointerId)"
    ></canvas>
    <span class="handwriting-pad-corner top-left" aria-hidden="true"></span>
    <span class="handwriting-pad-corner top-right" aria-hidden="true"></span>
    <span class="handwriting-pad-corner bottom-left" aria-hidden="true"></span>
    <span class="handwriting-pad-corner bottom-right" aria-hidden="true"></span>
  </div>
</template>

<style scoped>
.handwriting-pad {
  position: relative;
  width: min(100%, max(320px, calc(100dvh - 300px)));
  aspect-ratio: 1;
  margin-inline: auto;
  background: #fff;
  border: 1px solid #dfe5dc;
}

.handwriting-pad-canvas {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
  cursor: crosshair;
}

.handwriting-pad-corner {
  position: absolute;
  width: 18px;
  height: 18px;
  pointer-events: none;
}

.top-left { top: -1px; left: -1px; border-top: 2px solid #91a394; border-left: 2px solid #91a394; }
.top-right { top: -1px; right: -1px; border-top: 2px solid #91a394; border-right: 2px solid #91a394; }
.bottom-left { bottom: -1px; left: -1px; border-bottom: 2px solid #91a394; border-left: 2px solid #91a394; }
.bottom-right { right: -1px; bottom: -1px; border-right: 2px solid #91a394; border-bottom: 2px solid #91a394; }
</style>
