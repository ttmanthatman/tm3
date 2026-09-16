<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

const TICKER_SPEED_PX_PER_SECOND = 36;

const props = defineProps<{ items: string[] }>();
const viewport = ref<HTMLElement | null>(null);
const track = ref<HTMLElement | null>(null);
const tickerDistance = ref(0);
let resizeObserver: ResizeObserver | null = null;

const scrolling = computed(() => tickerDistance.value > 0);
const trackStyle = computed(() => ({
  "--activity-ticker-distance": `${tickerDistance.value}px`,
  "--activity-ticker-duration": `${(tickerDistance.value / TICKER_SPEED_PX_PER_SECOND).toFixed(1)}s`
}));

// The track holds two identical copies; one loop shifts exactly one copy plus
// the inter-copy gap, so the wrap is seamless. A leading padding of 100% of the
// viewport parks the first copy beyond the right edge so items scroll in from
// the right; that padding must stay out of the measured shift distance.
function measureTickerDistance() {
  const trackElement = track.value;
  if (!trackElement) return;
  const firstCopy = trackElement.firstElementChild as HTMLElement | null;
  const secondCopy = firstCopy?.nextElementSibling as HTMLElement | null;
  const copyWidth = firstCopy?.offsetWidth || 0;
  tickerDistance.value = firstCopy && secondCopy && copyWidth > 0 ? secondCopy.offsetLeft - firstCopy.offsetLeft : 0;
}

watch(() => props.items, () => void nextTick(measureTickerDistance), { deep: true });

onMounted(() => {
  resizeObserver = new ResizeObserver(measureTickerDistance);
  if (track.value) resizeObserver.observe(track.value);
  void nextTick(measureTickerDistance);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<template>
  <span ref="viewport" class="chat-activity-viewport">
    <span ref="track" class="chat-activity-track" :class="{ scrolling }" :style="trackStyle">
      <span v-for="copy in 2" :key="copy" class="chat-activity-copy" :aria-hidden="copy === 2 ? 'true' : undefined">
        <span v-for="(item, index) in items" :key="`${item}-${index}`" class="chat-activity-item">{{ item }}</span>
      </span>
    </span>
  </span>
</template>
