<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

const TICKER_SPEED_PX_PER_SECOND = 36;

const props = defineProps<{ items: string[] }>();
const viewport = ref<HTMLElement | null>(null);
const track = ref<HTMLElement | null>(null);
const viewportWidth = ref(0);
const contentWidth = ref(0);
let resizeObserver: ResizeObserver | null = null;

const scrolling = computed(() => viewportWidth.value > 0 && contentWidth.value > viewportWidth.value);
const trackStyle = computed(() => ({
  "--activity-ticker-start": `${viewportWidth.value}px`,
  "--activity-ticker-distance": `${contentWidth.value}px`,
  "--activity-ticker-duration": `${((viewportWidth.value + contentWidth.value) / TICKER_SPEED_PX_PER_SECOND).toFixed(1)}s`
}));

function measureOverflow() {
  const viewportElement = viewport.value;
  const trackElement = track.value;
  if (!viewportElement || !trackElement) return;
  viewportWidth.value = viewportElement.clientWidth;
  contentWidth.value = trackElement.scrollWidth;
}

watch(() => props.items, () => void nextTick(measureOverflow), { deep: true });

onMounted(() => {
  resizeObserver = new ResizeObserver(measureOverflow);
  if (viewport.value) resizeObserver.observe(viewport.value);
  if (track.value) resizeObserver.observe(track.value);
  void nextTick(measureOverflow);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<template>
  <span ref="viewport" class="chat-activity-viewport">
    <span ref="track" class="chat-activity-track" :class="{ scrolling }" :style="trackStyle">
      <span v-for="(item, index) in items" :key="`${item}-${index}`" class="chat-activity-item">{{ item }}</span>
    </span>
  </span>
</template>
