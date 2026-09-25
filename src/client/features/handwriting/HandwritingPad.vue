<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { HandwritingGlow, HandwritingStroke } from "@shared/handwriting";
import { handwritingBrushGeometry } from "./handwritingBrush";
import {
  appendHandwritingStroke,
  drawHandwritingCharacter,
  traceBrushFootprintPath
} from "./handwritingRenderer";
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
const tipMirror = ref<HTMLCanvasElement | null>(null);
const mirrorVisible = ref(false);
const diagnosticsEnabled = import.meta.env.DEV;
let activePointerId: number | null = null;
let activePointerType: "touch" | "other" | null = null;
let resizeObserver: ResizeObserver | null = null;
let mirrorFrame: number | null = null;
let renderedPointCounts: number[] = [];
let renderedColors: Array<string | undefined> = [];
let renderedGlow = "";

function redraw() {
  if (!canvas.value) return;
  drawHandwritingCharacter(canvas.value, { strokes: props.strokes }, { glow: props.glow });
  renderedPointCounts = props.strokes.map((stroke) => stroke.points.length);
  renderedColors = props.strokes.map((stroke) => stroke.color);
  renderedGlow = JSON.stringify(props.glow || null);
  queueTipMirror();
}

function syncAppendedInk() {
  if (!canvas.value) return;
  const glowChanged = renderedGlow !== JSON.stringify(props.glow || null);
  const requiresRedraw =
    glowChanged ||
    renderedPointCounts.length > props.strokes.length ||
    props.strokes.some((stroke, index) => {
      const renderedCount = renderedPointCounts[index] || 0;
      return (
        renderedCount > stroke.points.length ||
        (renderedCount > 0 && renderedColors[index] !== stroke.color)
      );
    });
  if (requiresRedraw) {
    redraw();
    return;
  }
  props.strokes.forEach((stroke, index) => {
    const renderedCount = renderedPointCounts[index] || 0;
    if (stroke.points.length > renderedCount)
      appendHandwritingStroke(canvas.value!, stroke, renderedCount, { glow: props.glow });
  });
  renderedPointCounts = props.strokes.map((stroke) => stroke.points.length);
  renderedColors = props.strokes.map((stroke) => stroke.color);
  renderedGlow = JSON.stringify(props.glow || null);
  queueTipMirror();
}

function drawMirrorMarker(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  radius = 3
) {
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
}

function renderTipMirror() {
  mirrorFrame = null;
  const mainCanvas = canvas.value;
  const mirrorCanvas = tipMirror.value;
  if (!mainCanvas || !mirrorCanvas || !mirrorVisible.value) return;
  const rect = mirrorCanvas.getBoundingClientRect();
  const cssWidth = Math.max(1, rect.width || 160);
  const cssHeight = Math.max(1, rect.height || 140);
  const ratio = Math.min(Math.max(globalThis.devicePixelRatio || 1, 1), 3);
  const pixelWidth = Math.max(1, Math.round(cssWidth * ratio));
  const pixelHeight = Math.max(1, Math.round(cssHeight * ratio));
  if (mirrorCanvas.width !== pixelWidth) mirrorCanvas.width = pixelWidth;
  if (mirrorCanvas.height !== pixelHeight) mirrorCanvas.height = pixelHeight;
  const context = mirrorCanvas.getContext("2d");
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  context.fillStyle = props.backgroundColor || "#fff";
  context.fillRect(0, 0, cssWidth, cssHeight);

  const stroke = props.strokes.at(-1);
  if (!stroke?.brush || !stroke.points.length) return;
  const sample = handwritingBrushGeometry(stroke).samples.at(-1);
  if (!sample) return;

  const mainRect = mainCanvas.getBoundingClientRect();
  const mainCssWidth = Math.max(1, mainRect.width || 1);
  const mainCssHeight = Math.max(1, mainRect.height || 1);
  const zoom = 2.8;
  const cropWidth = Math.min(10_000, (10_000 * cssWidth) / (mainCssWidth * zoom));
  const cropHeight = Math.min(10_000, (10_000 * cssHeight) / (mainCssHeight * zoom));
  const left = Math.max(0, Math.min(10_000 - cropWidth, sample.x - cropWidth / 2));
  const top = Math.max(0, Math.min(10_000 - cropHeight, sample.y - cropHeight / 2));
  const sourceX = (left / 10_000) * mainCanvas.width;
  const sourceY = (top / 10_000) * mainCanvas.height;
  const sourceWidth = (cropWidth / 10_000) * mainCanvas.width;
  const sourceHeight = (cropHeight / 10_000) * mainCanvas.height;
  context.drawImage(
    mainCanvas,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    cssWidth,
    cssHeight
  );

  const scaleX = cssWidth / cropWidth;
  const scaleY = cssHeight / cropHeight;
  const toMirror = (x: number, y: number) => ({
    x: (x - left) * scaleX,
    y: (y - top) * scaleY
  });
  const tip = toMirror(sample.x, sample.y);

  context.save();
  context.translate(tip.x, tip.y);
  context.scale(scaleX, scaleX);
  context.translate(-sample.x, -sample.y);
  context.beginPath();
  traceBrushFootprintPath(context, sample);
  context.fillStyle = "rgba(37, 99, 235, 0.18)";
  context.strokeStyle = "rgba(30, 64, 175, 0.72)";
  context.lineWidth = 1.25 / scaleX;
  context.fill();
  context.stroke();
  context.restore();

  if (!diagnosticsEnabled) return;
  const raw = toMirror(sample.rawX, sample.rawY);
  const input = toMirror(sample.inputX, sample.inputY);
  const handle = toMirror(sample.handleX, sample.handleY);
  context.lineWidth = 1;
  context.strokeStyle = "rgba(23, 53, 43, 0.42)";
  context.setLineDash([4, 3]);
  context.beginPath();
  context.moveTo(raw.x, raw.y);
  context.lineTo(input.x, input.y);
  context.lineTo(handle.x, handle.y);
  context.lineTo(tip.x, tip.y);
  context.stroke();
  context.setLineDash([]);
  drawMirrorMarker(context, raw.x, raw.y, "#ef6b73", 3);
  drawMirrorMarker(context, input.x, input.y, "#2f9fe8", 3);
  drawMirrorMarker(context, handle.x, handle.y, "#f3b44b", 3);
  drawMirrorMarker(context, tip.x, tip.y, "#23b26d", 3.5);
  context.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.fillStyle = "#17352b";
  context.fillText(`speed ${sample.speed.toFixed(2)}`, 8, 14);
  context.fillText(`contact ${sample.contact.toFixed(2)}`, 8, 27);
  context.fillText(`spread ${sample.spread.toFixed(2)}`, 8, 40);
  context.fillText(`angle ${sample.angle.toFixed(2)}`, 8, 53);
  context.fillText(`phase ${sample.phase}`, 8, 66);
  context.fillText(`raw ${Math.round(sample.rawX)},${Math.round(sample.rawY)}`, 8, 82);
  context.fillText(`input ${Math.round(sample.inputX)},${Math.round(sample.inputY)}`, 8, 94);
  context.fillText(`handle ${Math.round(sample.handleX)},${Math.round(sample.handleY)}`, 8, 106);
  context.fillText(`tip ${Math.round(sample.x)},${Math.round(sample.y)}`, 8, 118);
}

function queueTipMirror() {
  if (!mirrorVisible.value || typeof requestAnimationFrame === "undefined") return;
  if (mirrorFrame !== null) cancelAnimationFrame(mirrorFrame);
  mirrorFrame = requestAnimationFrame(renderTipMirror);
}

function inputPoint(event: PointerEvent): HandwritingInputPoint {
  const rect = canvas.value?.getBoundingClientRect();
  const width = rect?.width || 1;
  const height = rect?.height || 1;
  return {
    x: Math.max(
      0,
      Math.min(10_000, Math.round(((event.clientX - (rect?.left || 0)) / width) * 10_000))
    ),
    y: Math.max(
      0,
      Math.min(10_000, Math.round(((event.clientY - (rect?.top || 0)) / height) * 10_000))
    ),
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
  activePointerType = null;
  mirrorVisible.value = false;
  releasePointer(pointerId);
  emit("stroke-end", pointerId, inputPoint(event));
}

function cancel(pointerId: number) {
  if (activePointerId !== pointerId) return;
  activePointerId = null;
  activePointerType = null;
  mirrorVisible.value = false;
  releasePointer(pointerId);
  emit("stroke-cancel", pointerId);
}

function pointerDown(event: PointerEvent) {
  if (
    props.disabled ||
    activePointerId !== null ||
    (event.pointerType === "mouse" && event.button !== 0)
  )
    return;
  event.preventDefault();
  activePointerId = event.pointerId;
  activePointerType = event.pointerType === "touch" ? "touch" : "other";
  mirrorVisible.value = activePointerType === "touch";
  try {
    canvas.value?.setPointerCapture?.(event.pointerId);
  } catch {
    // Synthetic test pointers may not own a browser-managed active pointer.
  }
  emit("stroke-start", event.pointerId, inputPoint(event));
  queueTipMirror();
}

function pointerMove(event: PointerEvent) {
  if (props.disabled || activePointerId !== event.pointerId) return;
  const samples = event.getCoalescedEvents?.() || [];
  if (samples.length) {
    for (const sample of samples) emit("stroke-point", event.pointerId, inputPoint(sample));
  } else {
    emit("stroke-point", event.pointerId, inputPoint(event));
  }
  queueTipMirror();
}

function blur() {
  if (activePointerId !== null) cancel(activePointerId);
}

watch(() => props.strokes, redraw);
watch(() => props.strokes.map((stroke) => stroke.points.length), syncAppendedInk);
watch(() => props.glow, redraw, { deep: true });
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) blur();
  }
);
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
  if (mirrorFrame !== null) cancelAnimationFrame(mirrorFrame);
  mirrorFrame = null;
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
    <div
      class="handwriting-tip-mirror-frame"
      :class="{ 'is-visible': mirrorVisible }"
      aria-hidden="true"
    >
      <canvas ref="tipMirror"></canvas>
    </div>
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

.handwriting-tip-mirror-frame {
  display: none;
  position: absolute;
  z-index: 4;
  top: 10px;
  left: 50%;
  width: 160px;
  height: 140px;
  overflow: hidden;
  transform: translateX(-50%);
  background: #fff;
  border: 1px solid rgba(23, 53, 43, 0.28);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(23, 53, 43, 0.18);
  pointer-events: none;
}

.handwriting-tip-mirror-frame.is-visible {
  display: block;
}

.handwriting-tip-mirror-frame canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.handwriting-pad-corner {
  position: absolute;
  width: 18px;
  height: 18px;
  pointer-events: none;
}

.top-left {
  top: -1px;
  left: -1px;
  border-top: 2px solid #91a394;
  border-left: 2px solid #91a394;
}
.top-right {
  top: -1px;
  right: -1px;
  border-top: 2px solid #91a394;
  border-right: 2px solid #91a394;
}
.bottom-left {
  bottom: -1px;
  left: -1px;
  border-bottom: 2px solid #91a394;
  border-left: 2px solid #91a394;
}
.bottom-right {
  right: -1px;
  bottom: -1px;
  border-right: 2px solid #91a394;
  border-bottom: 2px solid #91a394;
}

@media (max-width: 420px) {
  .handwriting-tip-mirror-frame {
    width: 140px;
    height: 124px;
  }
}
@media (max-width: 600px) {
  .handwriting-tip-mirror-frame {
    position: fixed;
    z-index: 10;
    top: calc(env(safe-area-inset-top) + 100px);
    left: max(8px, env(safe-area-inset-left));
    transform: none;
  }
}
</style>
