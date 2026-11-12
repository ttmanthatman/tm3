<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { CalendarDays, Video } from "lucide-vue-next";
import AppMenu from "../../components/AppMenu.vue";
import AppMenuItem from "../../components/AppMenuItem.vue";
import ZoomControl from "../zoom/ZoomControl.vue";

const props = defineProps<{ isAdmin: boolean; calendarAvailable: boolean }>();
const emit = defineEmits<{ openCalendar: [] }>();
const menuOpen = ref(false);
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const zoom = ref<InstanceType<typeof ZoomControl> | null>(null);
const title = computed(() => `聚${zoom.value?.active ? "（正在开会）" : ""}${props.isAdmin ? "，长按设置线上会议" : ""}`);
let holdTimer: ReturnType<typeof setTimeout> | undefined;
let held = false;
let start: { x: number; y: number } | null = null;

function clearHold() { clearTimeout(holdTimer); holdTimer = undefined; }
function close(restoreFocus = false) {
  menuOpen.value = false;
  clearHold();
  if (restoreFocus) trigger.value?.focus({ preventScroll: true });
}
async function openMenu(last = false) {
  menuOpen.value = true;
  await nextTick();
  const items = root.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
  items?.[last ? items.length - 1 : 0]?.focus();
}
function toggleMenu() {
  clearHold();
  if (held) { held = false; return; }
  if (menuOpen.value) close();
  else void openMenu();
}
function openCalendar() { close(true); emit("openCalendar"); }
function openMeeting() { close(true); zoom.value?.open(); }
function openSettings() {
  if (!props.isAdmin) return;
  held = true;
  close(true);
  zoom.value?.openSettings();
}
function begin(event: PointerEvent) {
  clearHold();
  held = false;
  if (!props.isAdmin || event.button !== 0 || event.isPrimary === false) return;
  start = { x: event.clientX, y: event.clientY };
  trigger.value?.setPointerCapture(event.pointerId);
  holdTimer = setTimeout(openSettings, 550);
}
function move(event: PointerEvent) {
  if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) clearHold();
}
function endTouch(event: TouchEvent) {
  if (held && event.cancelable) event.preventDefault();
}
function keydown(event: KeyboardEvent) {
  if (!menuOpen.value) return;
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
  else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault(); event.stopPropagation();
    const items = [...root.value!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }
}
function outside(event: PointerEvent) {
  if (event.target instanceof Node && !root.value?.contains(event.target)) close();
}
function focusout(event: FocusEvent) {
  // Safari may blur without focusing a clicked menu item; keep that click alive.
  if (event.relatedTarget instanceof Node && !root.value?.contains(event.relatedTarget)) close();
}
watch(() => zoom.value?.visible, visible => { if (!visible) close(); });
watch(() => props.isAdmin, () => { clearHold(); held = false; });
onMounted(() => document.addEventListener("pointerdown", outside));
onBeforeUnmount(() => { clearHold(); document.removeEventListener("pointerdown", outside); });
</script>

<template>
  <div ref="root" class="gather-control" @keydown="keydown" @focusout="focusout">
    <button ref="trigger" class="icon-btn gather-header-trigger" type="button" :class="{ active: menuOpen, 'meeting-active': zoom?.active }" aria-label="聚" :title="title" aria-haspopup="menu" :aria-expanded="menuOpen" @click.stop="toggleMenu" @keydown.down.stop.prevent="openMenu()" @keydown.up.stop.prevent="openMenu(true)" @keydown.enter="held = false" @keydown.space="held = false" @keydown.shift.f10.stop.prevent="openSettings" @pointerdown="begin" @pointermove="move" @pointerup="clearHold" @pointercancel="clearHold" @pointerleave="clearHold" @lostpointercapture="clearHold" @touchend="endTouch" @contextmenu.prevent="openSettings">
      <span class="gather-glyph" aria-hidden="true">聚</span>
      <span v-if="zoom?.active" class="gather-meeting-dot" role="status" aria-label="线上会议进行中"></span>
    </button>
    <AppMenu v-if="menuOpen" class="gather-menu" label="聚" @click.stop>
      <AppMenuItem :disabled="!calendarAvailable" :title="calendarAvailable ? undefined : '请在群聊中打开日历'" @click="openCalendar"><CalendarDays :size="17" /><span>我们的日历</span></AppMenuItem>
      <AppMenuItem :active="zoom?.active" :title="zoom?.title" @click="openMeeting"><Video :size="17" /><span>线上会议</span><small v-if="zoom?.active">进行中</small></AppMenuItem>
    </AppMenu>
    <ZoomControl ref="zoom" hide-trigger :is-admin="isAdmin" :focus-target="trigger" />
  </div>
</template>

<style scoped>
.gather-control { position: relative; flex: 0 0 auto; }
.gather-header-trigger { position: relative; touch-action: manipulation; -webkit-touch-callout: none; user-select: none; }
.gather-glyph { font-size: 22px; font-weight: 600; line-height: 1; }
.gather-header-trigger.meeting-active { color: #246bff; }
.gather-meeting-dot { position: absolute; top: 3px; right: 3px; width: 6px; height: 6px; border-radius: 50%; background: #246bff; }
.gather-menu { position: absolute; top: calc(100% + 6px); right: 0; z-index: 44; width: 196px; }
.gather-menu small { margin-left: auto; font-size: 11px; }
</style>
