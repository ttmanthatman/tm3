<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { clampSermonFloatingPoint, sermonFloatingMoved, type SermonFloatingPoint } from "./sermonFloating";

const props = withDefaults(defineProps<{
  accessibleLabel: string;
  storageKey: string;
  offset?: number;
}>(), { offset: 0 });
const emit = defineEmits<{ activate: [] }>();

const button = ref<HTMLButtonElement | null>(null);
const position = ref<SermonFloatingPoint | null>(null);
let drag: { pointerId: number; start: SermonFloatingPoint; offset: SermonFloatingPoint } | null = null;
let suppressClick = false;

function size() {
  const rect = button.value?.getBoundingClientRect();
  return { width: rect?.width ?? 120, height: rect?.height ?? 48 };
}

function clamp(point: SermonFloatingPoint) {
  return clampSermonFloatingPoint(point, size(), { width: window.innerWidth, height: window.innerHeight }, 8);
}

function persist() {
  if (!position.value) return;
  try {
    localStorage.setItem(props.storageKey, JSON.stringify(position.value));
  } catch {
    // 位置持久化失败仅影响刷新后的默认落点。
  }
}

function restore() {
  try {
    const raw = localStorage.getItem(props.storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SermonFloatingPoint>;
      if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
        position.value = clamp({ x: Number(parsed.x), y: Number(parsed.y) });
        return;
      }
    }
  } catch {
    // 非法旧值按默认位置处理。
  }
  const element = size();
  position.value = clamp({
    x: window.innerWidth - element.width - 14,
    y: window.innerHeight - element.height - 86 - props.offset
  });
}

function pointerDown(event: PointerEvent) {
  if (event.button !== 0 || !position.value) return;
  drag = {
    pointerId: event.pointerId,
    start: { x: event.clientX, y: event.clientY },
    offset: { x: event.clientX - position.value.x, y: event.clientY - position.value.y }
  };
  suppressClick = false;
  button.value?.setPointerCapture(event.pointerId);
}

function pointerMove(event: PointerEvent) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  if (sermonFloatingMoved(drag.start, { x: event.clientX, y: event.clientY })) suppressClick = true;
  if (!suppressClick) return;
  position.value = clamp({ x: event.clientX - drag.offset.x, y: event.clientY - drag.offset.y });
}

function pointerUp(event: PointerEvent) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  if (button.value?.hasPointerCapture(event.pointerId)) button.value.releasePointerCapture(event.pointerId);
  drag = null;
  if (suppressClick) persist();
}

function activate(event: MouseEvent) {
  if (suppressClick) {
    event.preventDefault();
    suppressClick = false;
    return;
  }
  emit("activate");
}

function handleResize() {
  if (position.value) position.value = clamp(position.value);
}

onMounted(async () => {
  await nextTick();
  restore();
  window.addEventListener("resize", handleResize, { passive: true });
});

onBeforeUnmount(() => window.removeEventListener("resize", handleResize));
</script>

<template>
  <button
    ref="button"
    class="sermon-floating-button"
    type="button"
    :aria-label="props.accessibleLabel"
    :style="position ? { left: `${position.x}px`, top: `${position.y}px` } : undefined"
    @pointerdown="pointerDown"
    @pointermove="pointerMove"
    @pointerup="pointerUp"
    @pointercancel="pointerUp"
    @click="activate"
  >
    <slot />
  </button>
</template>

<style scoped>
.sermon-floating-button {
  position: fixed;
  z-index: 58;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 46px;
  max-width: min(260px, calc(100vw - 16px));
  padding: 10px 15px;
  border: 1px solid rgba(255, 255, 255, 0.26);
  border-radius: 999px;
  background: rgba(17, 24, 39, 0.92);
  color: #f8f4e8;
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.36);
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}

.sermon-floating-button:active {
  cursor: grabbing;
}

.sermon-floating-button:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--accent, #2563eb) 62%, white);
  outline-offset: 2px;
}
</style>
