<script setup lang="ts">
import { computed } from "vue";
import { compactBytes } from "../../time";

const props = withDefaults(
  defineProps<{
    label: string;
    loaded: number;
    total: number | null;
    percent?: number | null;
    error?: string;
  }>(),
  { percent: null, error: "" }
);

const shownPercent = computed(() => {
  if (props.percent !== null) return Math.min(100, Math.max(0, Math.round(props.percent)));
  return props.total ? Math.min(100, Math.floor((props.loaded / props.total) * 100)) : null;
});

const progressText = computed(() => {
  if (props.error) return props.error;
  if (shownPercent.value !== null) return `${shownPercent.value}%`;
  return compactBytes(props.loaded);
});

const byteText = computed(() => {
  if (!props.total) return `已接收 ${compactBytes(props.loaded)}`;
  return `${compactBytes(props.loaded)} / ${compactBytes(props.total)}`;
});
</script>

<template>
  <div class="transfer-progress" :class="{ error: !!error }">
    <div class="transfer-progress-copy">
      <span>{{ label }}</span>
      <strong>{{ progressText }}</strong>
    </div>
    <div
      class="transfer-progress-track"
      role="progressbar"
      aria-label="下载进度"
      :aria-valuemin="0"
      :aria-valuemax="100"
      :aria-valuenow="shownPercent ?? undefined"
      :aria-valuetext="shownPercent === null ? byteText : `${shownPercent}%`"
    >
      <span
        class="transfer-progress-fill"
        :class="{ indeterminate: shownPercent === null && !error }"
        :style="shownPercent === null ? undefined : { inlineSize: `${shownPercent}%` }"
      ></span>
    </div>
    <small v-if="!error">{{ byteText }}</small>
  </div>
</template>

<style scoped>
.transfer-progress {
  width: min(360px, calc(100vw - 36px));
  display: grid;
  gap: 7px;
  color: inherit;
}

.transfer-progress-copy {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 14px;
  min-width: 0;
  font-size: 13px;
}

.transfer-progress-copy span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.transfer-progress-copy strong {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
}

.transfer-progress-track {
  height: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, currentColor 16%, transparent);
}

.transfer-progress-fill {
  display: block;
  width: 0;
  height: 100%;
  border-radius: inherit;
  background: currentColor;
  transition: inline-size 120ms linear;
}

.transfer-progress-fill.indeterminate {
  width: 38%;
  animation: transfer-progress-slide 1.1s ease-in-out infinite alternate;
}

.transfer-progress small {
  color: inherit;
  opacity: .72;
  font-variant-numeric: tabular-nums;
}

.transfer-progress.error .transfer-progress-track {
  opacity: .35;
}

.transfer-progress.error strong {
  max-width: 240px;
  color: #b42318;
  text-align: right;
}

@keyframes transfer-progress-slide {
  from { transform: translateX(-100%); }
  to { transform: translateX(270%); }
}

@media (prefers-reduced-motion: reduce) {
  .transfer-progress-fill.indeterminate {
    animation-duration: 1ms;
  }
}
</style>
