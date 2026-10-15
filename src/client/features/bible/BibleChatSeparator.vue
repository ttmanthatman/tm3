<script setup lang="ts">
import { computed, ref } from "vue";
import { BIBLE_SPLIT_HANDLE_WIDTH, bibleSplitBounds } from "./useBibleDisplayLayout";

const props = defineProps<{ ratio: number; width: number; reversed: boolean }>();
const emit = defineEmits<{ resize: [ratio: number, snap: boolean]; swap: [] }>();
const dragging = ref(false);
const bounds = computed(() => bibleSplitBounds(props.width));
let pointerId: number | null = null;
let offset = 0;

function start(event: PointerEvent) {
  if (!event.isPrimary || event.button !== 0) return;
  const handle = event.currentTarget as HTMLElement;
  offset = event.clientX - handle.getBoundingClientRect().left;
  pointerId = event.pointerId;
  handle.setPointerCapture(event.pointerId);
  dragging.value = true;
  event.preventDefault();
}
function move(event: PointerEvent) {
  if (event.pointerId !== pointerId) return;
  const leftRatio = (event.clientX - offset) / (props.width - BIBLE_SPLIT_HANDLE_WIDTH);
  emit("resize", props.reversed ? 1 - leftRatio : leftRatio, true);
}
function stop() { dragging.value = false; pointerId = null; }
function keydown(event: KeyboardEvent) {
  let ratio = props.ratio;
  const step = (event.shiftKey ? 0.1 : 0.02) * (props.reversed ? -1 : 1);
  if (event.key === "ArrowLeft") ratio -= step;
  else if (event.key === "ArrowRight") ratio += step;
  else if (event.key === "Home") ratio = props.reversed ? bounds.value.max : bounds.value.min;
  else if (event.key === "End") ratio = props.reversed ? bounds.value.min : bounds.value.max;
  else if (event.key === "Enter") ratio = 0.5;
  else return;
  event.preventDefault();
  emit("resize", ratio, false);
}
</script>

<template>
  <div class="bible-chat-separator" :class="{ dragging }" data-no-bible-swipe>
    <div class="bible-chat-resize" role="separator" tabindex="0"
    aria-label="调整圣经和聊天宽度" aria-orientation="vertical" aria-controls="bible-workspace"
    :aria-valuenow="Math.round(ratio * 100)" :aria-valuemin="Math.ceil(bounds.min * 100)" :aria-valuemax="Math.floor(bounds.max * 100)"
    :aria-valuetext="`圣经${reversed ? '在右侧' : '在左侧'}，宽度 ${Math.round(ratio * 100)}%`"
    @pointerdown="start" @pointermove="move" @pointerup="stop" @pointercancel="stop" @lostpointercapture="stop"
    @keydown="keydown" @dblclick="emit('resize', 0.5, false)">
      <span class="bible-chat-grip" aria-hidden="true"></span>
    </div>
    <button class="bible-chat-swap" type="button" tabindex="0" aria-label="左右交换圣经和聊天" title="左右交换圣经和聊天"
      :disabled="dragging" @touchend.stop @click="emit('swap')"></button>
  </div>
</template>

<style scoped>
.bible-chat-separator { position: relative; grid-column: 2; grid-row: 1; z-index: 6; user-select: none; background: var(--panel); }
.bible-chat-resize { position: absolute; inset: 0; display: grid; place-items: center; cursor: col-resize; touch-action: none; border-inline: 1px solid var(--line); }
.bible-chat-grip { width: 4px; height: 44px; border-radius: 3px; background: #a89477; }
.bible-chat-separator:hover, .bible-chat-separator:focus-within, .bible-chat-separator.dragging { background: #e1d4bc; }
.bible-chat-resize:focus-visible { outline: 2px solid #947044; outline-offset: -2px; }
.bible-chat-swap { position: absolute; left: 0; top: 0; width: 100%; height: var(--bible-topbar-height); min-width: 0; padding: 0; border: 0; border-inline: 1px solid #899a7d; border-bottom: 1px solid #7d8f70; border-radius: 0; background: #a1b195; box-shadow: none; cursor: pointer; touch-action: manipulation; }
.bible-chat-swap:hover, .bible-chat-swap:focus-visible { background: #819571; }
.bible-chat-swap:focus-visible { outline: 2px solid #415a35; outline-offset: -2px; }
</style>
