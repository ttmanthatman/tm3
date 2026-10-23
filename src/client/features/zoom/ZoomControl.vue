<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import ZoomMeetingDialog from "./ZoomMeetingDialog.vue";
import { useZoomMeeting } from "./useZoomMeeting";

defineProps<{ isAdmin: boolean }>();
const zoom = useZoomMeeting();
const dialogOpen = ref(false);
const trigger = ref<HTMLAnchorElement | null>(null);
const title = computed(() => `${zoom.active.value ? '正在开会 · ' : ''}Zoom${zoom.settings.value.url ? '' : '（管理员尚未设置会议链接）'}，长按查看会议状态`);
let holdTimer: ReturnType<typeof setTimeout> | undefined;
let held = false;
let start: { x: number; y: number } | null = null;
function clearHold() { clearTimeout(holdTimer); holdTimer = undefined; }
function begin(event: PointerEvent) {
  if (event.button !== 0) return;
  clearHold();
  held = false;
  start = { x: event.clientX, y: event.clientY };
  trigger.value?.setPointerCapture(event.pointerId);
  holdTimer = setTimeout(() => { held = true; dialogOpen.value = true; clearHold(); }, 550);
}
function move(event: PointerEvent) {
  if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) clearHold();
}
function click(event: MouseEvent) {
  clearHold();
  if (held) { event.preventDefault(); held = false; return; }
  if (!zoom.settings.value.url) { event.preventDefault(); dialogOpen.value = true; }
}
function openDialog() { clearHold(); held = true; dialogOpen.value = true; }
function closeDialog() { dialogOpen.value = false; trigger.value?.focus({ preventScroll: true }); }
watch(zoom.visible, value => { if (!value) clearHold(); });
onBeforeUnmount(clearHold);
</script>

<template>
  <a ref="trigger" class="icon-btn zoom-header-trigger" :class="{ 'meeting-active': zoom.active.value, 'meeting-animate': zoom.active.value && zoom.visible.value }" :href="zoom.settings.value.url || undefined" target="_blank" rel="noopener noreferrer" :aria-label="title" :title="title" tabindex="0" @pointerdown.stop="begin" @pointermove="move" @pointerup="clearHold" @pointercancel="clearHold" @pointerleave="clearHold" @click.stop="click" @contextmenu.prevent="openDialog" @keydown.enter="!zoom.settings.value.url && (dialogOpen = true)" @keydown.space.prevent="dialogOpen = true" @keydown.shift.f10.prevent="openDialog" @keydown.escape="clearHold">
    <svg viewBox="0 0 36 36" width="28" height="28" aria-hidden="true">
      <rect class="zoom-tile" x="2" y="2" width="32" height="32" rx="9" />
      <g class="zoom-wordmark" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5.6 15.4h4.7l-4.7 5.2h4.7" />
        <circle cx="14.2" cy="18" r="2.6" /><circle cx="20.7" cy="18" r="2.6" />
        <path d="M25 20.6v-3.4a1.8 1.8 0 0 1 3.6 0v3.4m0-3.4a1.8 1.8 0 0 1 3.6 0v3.4" transform="translate(-.9)" />
      </g>
    </svg>
  </a>
  <Teleport to="body"><ZoomMeetingDialog v-if="dialogOpen" :zoom="zoom" :is-admin="isAdmin" @close="closeDialog" /></Teleport>
</template>

<style scoped>
.zoom-header-trigger { position: relative; flex-shrink: 0; color: var(--text); touch-action: manipulation; -webkit-touch-callout: none; user-select: none; }
.zoom-header-trigger svg { position: relative; z-index: 1; }
.zoom-tile { fill: none; stroke: currentColor; stroke-width: 1.5; }
.zoom-wordmark { stroke: currentColor; }
.zoom-header-trigger.meeting-active { color: #246bff; }
.meeting-active .zoom-tile { fill: currentColor; stroke: none; }
.meeting-active .zoom-wordmark { stroke: white; }
.zoom-header-trigger::before { content: ''; position: absolute; inset: 3px; border-radius: 9px; background: #8f65e44d; opacity: 0; pointer-events: none; }
.zoom-header-trigger.meeting-animate::before { animation: zoom-halo 2.8s ease-in-out infinite; }
.zoom-header-trigger.meeting-animate svg { animation: zoom-breathe 2.8s ease-in-out infinite; transform-origin: center; }
@keyframes zoom-halo { 0%, 100% { opacity: .15; transform: scale(.78); } 50% { opacity: .8; transform: scale(1.12); } }
@keyframes zoom-breathe { 0%, 100% { color: #246bff; opacity: .78; transform: scale(.86); } 50% { color: #9751df; opacity: 1; transform: scale(1.04); } }
@media (prefers-reduced-motion: reduce) { .zoom-header-trigger.meeting-animate::before, .zoom-header-trigger.meeting-animate svg { animation: none; } .zoom-header-trigger.meeting-active::before { opacity: .6; } }
</style>
