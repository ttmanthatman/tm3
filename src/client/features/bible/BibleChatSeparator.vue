<script setup lang="ts">
import { computed, ref } from "vue";
import { BIBLE_SPLIT_HANDLE_WIDTH, bibleSplitBounds } from "./useBibleDisplayLayout";

const props = defineProps<{ ratio: number; width: number }>();
const emit = defineEmits<{ resize: [ratio: number, snap: boolean] }>();
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
  emit("resize", (event.clientX - offset) / (props.width - BIBLE_SPLIT_HANDLE_WIDTH), true);
}
function stop() { dragging.value = false; pointerId = null; }
function keydown(event: KeyboardEvent) {
  let ratio = props.ratio;
  if (event.key === "ArrowLeft") ratio -= event.shiftKey ? 0.1 : 0.02;
  else if (event.key === "ArrowRight") ratio += event.shiftKey ? 0.1 : 0.02;
  else if (event.key === "Home") ratio = bounds.value.min;
  else if (event.key === "End") ratio = bounds.value.max;
  else if (event.key === "Enter") ratio = 0.5;
  else return;
  event.preventDefault();
  emit("resize", ratio, false);
}
</script>

<template>
  <div class="bible-chat-separator" :class="{ dragging }" role="separator" tabindex="0"
    aria-label="调整圣经和聊天宽度" aria-orientation="vertical" aria-controls="bible-workspace"
    :aria-valuenow="Math.round(ratio * 100)" :aria-valuemin="Math.ceil(bounds.min * 100)" :aria-valuemax="Math.floor(bounds.max * 100)"
    :aria-valuetext="`圣经 ${Math.round(ratio * 100)}%`" data-no-bible-swipe
    @pointerdown="start" @pointermove="move" @pointerup="stop" @pointercancel="stop" @lostpointercapture="stop"
    @keydown="keydown" @dblclick="emit('resize', 0.5, false)">
    <span aria-hidden="true"></span>
  </div>
</template>

<style scoped>
.bible-chat-separator { grid-column: 2; grid-row: 1; z-index: 6; display: grid; place-items: center; cursor: col-resize; touch-action: none; user-select: none; background: var(--panel); border-inline: 1px solid var(--line); }
.bible-chat-separator span { width: 4px; height: 44px; border-radius: 3px; background: #a89477; }
.bible-chat-separator:hover, .bible-chat-separator.dragging, .bible-chat-separator:focus-visible { background: #e1d4bc; outline: 2px solid #947044; outline-offset: -2px; }
</style>
