<script setup lang="ts">
import { defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import AppMenu from "../../components/AppMenu.vue";
import AppMenuItem from "../../components/AppMenuItem.vue";

const Library = defineAsyncComponent(() => import("./MusicScoreLibrary.vue"));
const props = defineProps<{ currentScoreAvailable: boolean; currentChannelId?: number | null }>();
const emit = defineEmits<{ current: [] }>();
const menuOpen = ref(false);
const libraryOpen = ref(false);
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);

function openMenu() {
  if (!props.currentScoreAvailable) { libraryOpen.value = true; return; }
  menuOpen.value = !menuOpen.value;
}
async function focusItem(last = false) {
  await nextTick();
  const items = root.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
  items?.[last ? items.length - 1 : 0]?.focus();
}
function closeMenu(restoreFocus = false) {
  menuOpen.value = false;
  if (restoreFocus) trigger.value?.focus();
}
function select(current: boolean) {
  closeMenu(true);
  if (current) emit("current");
  else libraryOpen.value = true;
}
function keydown(event: KeyboardEvent) {
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeMenu(true); }
  else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    const items = [...root.value!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  } else if (event.key === "Tab") closeMenu();
}
function outside(event: PointerEvent) {
  if (event.target instanceof Node && !root.value?.contains(event.target)) closeMenu();
}
watch(() => props.currentScoreAvailable, available => { if (!available) closeMenu(); });
onMounted(() => document.addEventListener("pointerdown", outside));
onBeforeUnmount(() => document.removeEventListener("pointerdown", outside));
</script>

<template>
  <div ref="root" class="score-library-control" @click.stop @keydown="menuOpen && keydown($event)">
    <button ref="trigger" type="button" class="icon-btn score-library-trigger" :class="{ 'has-current-score': currentScoreAvailable, active: menuOpen || libraryOpen }" :aria-label="currentScoreAvailable ? '打开歌谱菜单' : '打开歌谱库'" title="歌谱" :aria-haspopup="currentScoreAvailable ? 'menu' : 'dialog'" :aria-expanded="menuOpen || libraryOpen" @click="openMenu" @keydown.down.stop.prevent="currentScoreAvailable && (menuOpen = true, focusItem())" @keydown.up.stop.prevent="currentScoreAvailable && (menuOpen = true, focusItem(true))">
      <span class="music-player-glyph" aria-hidden="true">谱</span>
    </button>
    <AppMenu v-if="menuOpen" class="score-library-menu" label="歌谱菜单">
      <AppMenuItem @click="select(true)">当前歌谱</AppMenuItem>
      <AppMenuItem @click="select(false)">其他歌谱</AppMenuItem>
    </AppMenu>
    <Library v-if="libraryOpen" :current-channel-id="currentChannelId" @close="libraryOpen = false; trigger?.focus()" />
  </div>
</template>

<style scoped>
.score-library-control { position: relative; flex-shrink: 0; }
.score-library-trigger.has-current-score { color: #b45826; }
.score-library-menu { position: absolute; top: calc(100% + 6px); right: 0; z-index: 44; width: 150px; }
</style>
