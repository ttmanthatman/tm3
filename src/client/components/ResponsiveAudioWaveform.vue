<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { computeWaveformGeometry, resampleWaveform } from "../audioWaveform";

const props = defineProps<{
  samples: number[];
  progress: number;
}>();

const emit = defineEmits<{
  seek: [progress: number];
}>();

const canvas = ref<HTMLCanvasElement | null>(null);
let resizeObserver: ResizeObserver | null = null;

function draw() {
  const element = canvas.value;
  if (!element) return;
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const dpr = window.devicePixelRatio || 1;
  const geometry = computeWaveformGeometry(rect.width, dpr);
  const canvasHeightPx = Math.max(1, Math.round(rect.height * dpr));
  if (element.width !== geometry.canvasWidthPx) element.width = geometry.canvasWidthPx;
  if (element.height !== canvasHeightPx) element.height = canvasHeightPx;

  const context = element.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, geometry.canvasWidthPx, canvasHeightPx);

  const baselineHeight = Math.max(1, Math.round(dpr));
  context.fillStyle = "rgba(71, 85, 105, 0.16)";
  context.fillRect(0, canvasHeightPx - baselineHeight, geometry.canvasWidthPx, baselineHeight);

  const bars = resampleWaveform(props.samples, geometry.barCount);
  const progress = Math.min(1, Math.max(0, props.progress));
  const availableHeight = Math.max(1, canvasHeightPx - Math.round(6 * dpr));
  bars.forEach((sample, index) => {
    const height = Math.max(Math.round(7 * dpr), Math.round((0.2 + sample * 0.8) * availableHeight));
    const x = geometry.offsetPx + index * (geometry.barWidthPx + geometry.gapPx);
    const y = Math.max(0, Math.floor((canvasHeightPx - height) / 2));
    context.fillStyle = (index + 0.5) / Math.max(1, bars.length) <= progress ? "#ff5500" : "rgba(71, 85, 105, 0.34)";
    context.fillRect(x, y, geometry.barWidthPx, height);
  });
}

function handleSeek(event: MouseEvent) {
  const element = canvas.value;
  if (!element) return;
  const rect = element.getBoundingClientRect();
  if (!rect.width) return;
  emit("seek", Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)));
}

watch(() => [props.samples, props.progress], () => void nextTick(draw), { deep: true });

onMounted(() => {
  resizeObserver = new ResizeObserver(draw);
  if (canvas.value) resizeObserver.observe(canvas.value);
  void nextTick(draw);
});

onBeforeUnmount(() => resizeObserver?.disconnect());
</script>

<template>
  <button type="button" class="inline-audio-waveform" aria-label="音频进度，点击跳转" @click="handleSeek">
    <canvas ref="canvas" aria-hidden="true"></canvas>
  </button>
</template>
