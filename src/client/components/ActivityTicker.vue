<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { advanceActivityTickerPosition } from "../activityTicker";

const props = defineProps<{ items: string[] }>();
const viewport = ref<HTMLElement | null>(null);
const track = ref<HTMLElement | null>(null);
const position = ref(0);
let frame = 0;
let previousTime = 0;
let resizeObserver: ResizeObserver | null = null;

function resetPosition() {
  position.value = viewport.value?.clientWidth || 0;
}

function tick(now: number) {
  const elapsed = previousTime ? Math.min(100, now - previousTime) : 0;
  previousTime = now;
  if (!document.hidden && viewport.value && track.value) {
    position.value = advanceActivityTickerPosition(
      position.value,
      elapsed,
      track.value.scrollWidth,
      viewport.value.clientWidth
    );
  }
  frame = window.requestAnimationFrame(tick);
}

watch(() => props.items, () => void nextTick(() => {
  if (track.value && position.value <= -track.value.scrollWidth) resetPosition();
}), { deep: true });

onMounted(() => {
  resetPosition();
  resizeObserver = new ResizeObserver(() => {
    if (position.value > (viewport.value?.clientWidth || 0)) resetPosition();
  });
  if (viewport.value) resizeObserver.observe(viewport.value);
  if (track.value) resizeObserver.observe(track.value);
  frame = window.requestAnimationFrame(tick);
});

onBeforeUnmount(() => {
  window.cancelAnimationFrame(frame);
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<template>
  <span ref="viewport" class="chat-activity-viewport">
    <span ref="track" class="chat-activity-track" :style="{ transform: `translate3d(${position}px, 0, 0)` }">
      <span v-for="(item, index) in items" :key="`${item}-${index}`" class="chat-activity-item">{{ item }}</span>
    </span>
  </span>
</template>
