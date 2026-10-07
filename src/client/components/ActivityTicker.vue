<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

const TICKER_SPEED_PX_PER_SECOND = 36;

const props = defineProps<{ items: string[] }>();
const viewport = ref<HTMLElement | null>(null);
const track = ref<HTMLElement | null>(null);
const tickerDistance = ref(0);
const viewportWidth = ref(0);
const active = ref(false);
let resizeObserver: ResizeObserver | null = null;
let visibilityObserver: IntersectionObserver | null = null;
let visible = false;

const scrolling = computed(() => tickerDistance.value > 0);
const trackStyle = computed(() => ({
  "--activity-ticker-distance": `${tickerDistance.value}px`,
  "--activity-ticker-start": `${viewportWidth.value}px`,
  "--activity-ticker-duration": `${((viewportWidth.value + tickerDistance.value) / TICKER_SPEED_PX_PER_SECOND).toFixed(1)}s`,
  animationPlayState: active.value ? "running" : "paused"
}));

// Travel from beyond the right edge until the entire copy clears the left.
// A short status must cross the viewport too, not just its own text width.
function measureTickerDistance() {
  const trackElement = track.value;
  if (!trackElement) return;
  const firstCopy = trackElement.firstElementChild as HTMLElement | null;
  viewportWidth.value = viewport.value?.clientWidth || 0;
  tickerDistance.value = firstCopy?.scrollWidth || 0;
}

function updateActivity() { active.value = visible && !document.hidden; }
function pause() { active.value = false; }

watch(() => props.items, () => void nextTick(measureTickerDistance), { deep: true });

onMounted(() => {
  resizeObserver = new ResizeObserver(measureTickerDistance);
  if (track.value) resizeObserver.observe(track.value);
  if (viewport.value) resizeObserver.observe(viewport.value);
  visibilityObserver = new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    updateActivity();
  });
  if (viewport.value) visibilityObserver.observe(viewport.value);
  document.addEventListener("visibilitychange", updateActivity);
  window.addEventListener("pagehide", pause);
  window.addEventListener("pageshow", updateActivity);
  void nextTick(measureTickerDistance);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  visibilityObserver?.disconnect();
  document.removeEventListener("visibilitychange", updateActivity);
  window.removeEventListener("pagehide", pause);
  window.removeEventListener("pageshow", updateActivity);
});
</script>

<template>
  <span ref="viewport" class="chat-activity-viewport" :class="{ paused: !active }">
    <span ref="track" class="chat-activity-track" :class="{ scrolling }" :style="trackStyle">
      <span class="chat-activity-copy">
        <span v-for="(item, index) in items" :key="`${item}-${index}`" class="chat-activity-item">{{ item }}</span>
      </span>
    </span>
  </span>
</template>
