<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps<{ text: string }>();
const viewport = ref<HTMLElement | null>(null);
const content = ref<HTMLElement | null>(null);
const overflowDistance = ref(0);
let resizeObserver: ResizeObserver | null = null;

const trackStyle = computed(() => ({
  "--overflow-distance": `${overflowDistance.value}px`,
  "--marquee-duration": `${Math.max(4.8, overflowDistance.value / 18).toFixed(1)}s`
}));

function measureOverflow() {
  const viewportElement = viewport.value;
  const contentElement = content.value;
  if (!viewportElement || !contentElement) return;
  overflowDistance.value = Math.max(0, Math.ceil(contentElement.scrollWidth - viewportElement.clientWidth));
}

watch(() => props.text, () => void nextTick(measureOverflow));

onMounted(() => {
  resizeObserver = new ResizeObserver(measureOverflow);
  if (viewport.value) resizeObserver.observe(viewport.value);
  if (content.value) resizeObserver.observe(content.value);
  void nextTick(measureOverflow);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<template>
  <small ref="viewport" class="overflow-marquee" :title="text">
    <span
      ref="content"
      class="overflow-marquee-track"
      :class="{ scrolling: overflowDistance > 0 }"
      :style="trackStyle"
    >{{ text }}</span>
  </small>
</template>

<style scoped>
.overflow-marquee {
  min-width: 0;
  display: block;
  overflow: hidden;
  white-space: nowrap;
}

.overflow-marquee-track {
  width: max-content;
  display: inline-block;
  will-change: transform;
}

.overflow-marquee-track.scrolling {
  animation: chatSubtitleMarquee var(--marquee-duration) ease-in-out infinite alternate;
}

@keyframes chatSubtitleMarquee {
  from { transform: translateX(0); }
  to { transform: translateX(calc(0px - var(--overflow-distance))); }
}

@media (prefers-reduced-motion: reduce) {
  .overflow-marquee-track.scrolling {
    animation-duration: calc(var(--marquee-duration) * 1.8);
  }
}
</style>
