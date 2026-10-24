<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import AppModal from "../../components/ui/AppModal.vue";
import ConfirmDialog from "../../components/ui/ConfirmDialog.vue";
import ZoomMeetingDialog from "./ZoomMeetingDialog.vue";
import { useSharedZoomMeeting } from "./useZoomMeeting";

const props = defineProps<{ isAdmin: boolean }>();
const zoom = useSharedZoomMeeting();
const dialogOpen = ref(false);
const joinOpen = ref(false);
const noticeOpen = ref(false);
const trigger = ref<HTMLButtonElement | null>(null);
const title = computed(() => {
  const status = zoom.error.value || (zoom.ready.value && zoom.status.value === "unknown") ? "（会议状态暂时无法确认）" : !zoom.ready.value ? "（加载中）" : !zoom.settings.value.url ? "（管理员尚未设置会议链接）" : zoom.active.value ? "（正在开会）" : "";
  return `Zoom${status}${props.isAdmin ? '，长按设置会议状态' : ''}`;
});
const joinMessage = computed(() => zoom.error.value || !zoom.ready.value || zoom.status.value === "unknown"
  ? "暂时无法确认会议状态，是否仍要前往 Zoom？"
  : "目前还没有会议，但你可以进去开始一个会议，是否确定？");
const noticeMessage = computed(() => zoom.error.value
  ? "会议链接暂时无法加载，请稍后重试。"
  : !zoom.ready.value ? "正在加载会议链接，请稍后重试。" : "管理员尚未设置会议链接，请联系管理员。");
let holdTimer: ReturnType<typeof setTimeout> | undefined;
let held = false;
let start: { x: number; y: number } | null = null;
function clearHold() { clearTimeout(holdTimer); holdTimer = undefined; }
function begin(event: PointerEvent) {
  clearHold();
  held = false;
  if (!props.isAdmin || event.button !== 0 || event.isPrimary === false) return;
  start = { x: event.clientX, y: event.clientY };
  trigger.value?.setPointerCapture(event.pointerId);
  holdTimer = setTimeout(openDialog, 550);
}
function move(event: PointerEvent) {
  if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) clearHold();
}
function endTouch(event: TouchEvent) {
  // A held finger can release over the newly opened modal backdrop. Suppress
  // its synthetic click so it cannot immediately dismiss the settings dialog.
  if (held && event.cancelable) event.preventDefault();
}
function openMeeting() {
  const url = zoom.settings.value.url;
  if (!url) { joinOpen.value = false; noticeOpen.value = true; return; }
  window.open(url, "_blank", "noopener,noreferrer");
  joinOpen.value = false;
}
function click() {
  clearHold();
  if (held) { held = false; return; }
  held = false;
  trigger.value?.focus({ preventScroll: true });
  if (!zoom.settings.value.url) { noticeOpen.value = true; return; }
  if (!zoom.error.value && zoom.ready.value && zoom.active.value) openMeeting();
  else joinOpen.value = true;
}
function openDialog() {
  clearHold();
  if (!props.isAdmin) return;
  held = true;
  trigger.value?.focus({ preventScroll: true });
  dialogOpen.value = true;
}
function closeDialog() { dialogOpen.value = false; trigger.value?.focus({ preventScroll: true }); }
watch(zoom.visible, value => { if (!value) clearHold(); });
watch(() => props.isAdmin, value => { if (!value) { clearHold(); dialogOpen.value = false; } });
onBeforeUnmount(clearHold);
</script>

<template>
  <button ref="trigger" type="button" class="icon-btn zoom-header-trigger" :class="{ 'meeting-active': zoom.active.value, 'meeting-animate': zoom.active.value && zoom.visible.value }" :aria-label="title" :title="title" @pointerdown.stop="begin" @pointermove="move" @pointerup="clearHold" @pointercancel="clearHold" @pointerleave="clearHold" @lostpointercapture="clearHold" @touchend="endTouch" @click.stop="click" @contextmenu.prevent="openDialog" @keydown.enter="held = false" @keydown.space="held = false" @keydown.shift.f10.prevent="openDialog" @keydown.escape="clearHold">
    <svg viewBox="0 0 36 36" width="28" height="28" aria-hidden="true">
      <rect class="zoom-tile" x="2" y="2" width="32" height="32" rx="9" />
      <g class="zoom-wordmark" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5.6 15.4h4.7l-4.7 5.2h4.7" />
        <circle cx="14.2" cy="18" r="2.6" /><circle cx="20.7" cy="18" r="2.6" />
        <path d="M25 20.6v-3.4a1.8 1.8 0 0 1 3.6 0v3.4m0-3.4a1.8 1.8 0 0 1 3.6 0v3.4" transform="translate(-.9)" />
      </g>
    </svg>
  </button>
  <Teleport to="body">
    <ZoomMeetingDialog v-if="dialogOpen && isAdmin" :zoom="zoom" :is-admin="isAdmin" @close="closeDialog" />
    <ConfirmDialog v-if="joinOpen" open title="前往 Zoom" :message="joinMessage" detail="能否直接开始会议取决于 Zoom 的主持人和入会设置。" confirm-text="确定" @close="joinOpen = false" @confirm="openMeeting" />
    <AppModal v-if="noticeOpen" open title="Zoom" @close="noticeOpen = false"><div class="confirm-body"><p role="status">{{ noticeMessage }}</p></div></AppModal>
  </Teleport>
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
