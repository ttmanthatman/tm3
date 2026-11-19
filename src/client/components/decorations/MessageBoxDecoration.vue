<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from "vue";
import { cleanRainbowOrbit, rainbowSamples, type RainbowOrbitSettings } from "@shared/rainbowOrbit";
import { observeDecorationVisibility } from "./decorationVisibility";

/** Presentation-only decoration category; place inside any positioned box. */
const props = withDefaults(defineProps<{
  kind?: "none" | "rainbow-orbit";
  active?: boolean;
  radius?: number;
  settings?: RainbowOrbitSettings;
}>(), { kind: "rainbow-orbit", active: true, radius: 6 });
const root = ref<SVGSVGElement | null>(null);
const visible = ref(false);
const width = ref(0);
const height = ref(0);
const enabled = computed(() => props.active && props.kind === "rainbow-orbit");
const haloId = `message-halo-${useId()}`;
// Small overlapping strokes sample one continuous spectrum by arc length.
// pathLength keeps the speed uniform on long sides, short sides and corners.
const config = computed(() => cleanRainbowOrbit(props.settings));
const colors = computed(() => rainbowSamples(config.value));
const boxMask = computed(() => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width.value}" height="${height.value}"><rect x="1" y="1" width="${Math.max(0, width.value - 2)}" height="${Math.max(0, height.value - 2)}" rx="${Math.max(0, props.radius - 1)}" fill="white"/></svg>`)}`);
let dispose: (() => void) | undefined;
onMounted(() => {
  const svg = root.value;
  const host = svg?.parentElement;
  if (!svg || !host) return;
  const resize = new ResizeObserver(() => {
    width.value = svg.clientWidth;
    height.value = svg.clientHeight;
  });
  resize.observe(host);
  const stopVisibility = observeDecorationVisibility(host, value => { visible.value = value; });
  dispose = () => { resize.disconnect(); stopVisibility(); };
});
onBeforeUnmount(() => dispose?.());
</script>

<template>
  <svg ref="root" class="message-box-decoration" :class="{ active: enabled, running: enabled && visible }"
    :style="{ '--ribbon-lap': `${colors.length}px` }" :data-decoration="kind" aria-hidden="true" focusable="false">
    <defs>
      <!-- Derive the halo from this frame's rendered stroke. An animated <use>
           clone can run on a different timeline and separate the colors. -->
      <filter :id="haloId" filterUnits="userSpaceOnUse" x="-44" y="-44"
        :width="width + 88" :height="height + 88" color-interpolation-filters="sRGB">
        <feImage :href="boxMask" x="0" y="0" :width="width" :height="height" result="box" />
        <feMorphology in="SourceGraphic" operator="dilate" radius="1" result="wide" />
        <feGaussianBlur in="wide" :stdDeviation="config.innerWidth / 3" result="innerBlur" />
        <feComposite in="innerBlur" in2="box" operator="in" result="innerClip" />
        <feComponentTransfer in="innerClip" result="innerHalo"><feFuncA type="linear" :slope="config.innerWidth ? 0.8 : 0" /></feComponentTransfer>
        <feGaussianBlur in="wide" :stdDeviation="config.outerWidth / 3" result="outerBlur" />
        <feComposite in="outerBlur" in2="box" operator="out" result="outerClip" />
        <feComponentTransfer in="outerClip" result="outerHalo"><feFuncA type="linear" :slope="config.outerWidth ? 0.8 : 0" /></feComponentTransfer>
        <feMerge>
          <feMergeNode in="innerHalo" /><feMergeNode in="outerHalo" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    <g fill="none" :filter="`url(#${haloId})`">
      <rect v-for="(color, i) in colors" :key="i" x="1" y="1"
        :width="Math.max(0, width - 2)" :height="Math.max(0, height - 2)"
        :rx="Math.max(0, radius - 1)" :pathLength="colors.length"
        :stroke="color" :stroke-dasharray="`1.15 ${colors.length - 1.15}`"
        :style="{ '--ribbon-offset': `${-i}px` }" class="message-box-decoration-segment" />
    </g>
  </svg>
</template>

<style scoped>
.message-box-decoration {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
  z-index: 2;
  stroke-width: 1.6px;
  opacity: 0;
  transition: opacity 220ms ease;
}
.message-box-decoration.active { opacity: 1; }
.message-box-decoration-segment {
  stroke-dashoffset: var(--ribbon-offset);
  animation: message-box-rainbow-orbit 8s linear infinite;
  animation-play-state: paused;
}
.running .message-box-decoration-segment { animation-play-state: running; }
@keyframes message-box-rainbow-orbit {
  from { stroke-dashoffset: var(--ribbon-offset); }
  to { stroke-dashoffset: calc(var(--ribbon-offset) - var(--ribbon-lap)); }
}
@media (prefers-reduced-motion: reduce) {
  .message-box-decoration-segment { animation: none; }
  .message-box-decoration { transition: none; }
}
</style>
