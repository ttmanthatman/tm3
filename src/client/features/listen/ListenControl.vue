<script setup lang="ts">
import { defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { Headphones, Music, Pause, Play, Radio, SkipBack, SkipForward } from "lucide-vue-next";
import type { MusicPlaylistDTO, MusicTrackDTO } from "@shared/types";
import AppMenu from "../../components/AppMenu.vue";
import AppMenuItem from "../../components/AppMenuItem.vue";
import OverflowMarquee from "../../components/OverflowMarquee.vue";
import MusicScoreControl from "../music/MusicScoreControl.vue";
import type { MusicPlayer } from "../music/useMusicPlayer";
import type { MusicSleepTimer } from "../music/useMusicSleepTimer";
import type { HeaderPlayback } from "./useHeaderPlayback";
import { useHeaderVisibility } from "./useHeaderVisibility";

const MusicMiniPanel = defineAsyncComponent(() => import("../music/MusicMiniPanel.vue"));
const expanded = defineModel<boolean>("expanded", { required: true });
const props = defineProps<{
  playback: HeaderPlayback;
  musicPlayer: MusicPlayer;
  favoriteTracks: MusicTrackDTO[];
  playlists: MusicPlaylistDTO[];
  sleepTimer: MusicSleepTimer;
  fontSize: number;
  currentScoreAvailable: boolean;
  currentChannelId?: number | null;
  openMusic: () => void;
  openFriend: () => void;
  toggleFavorite: () => void;
  openManager: () => void;
}>();
const emit = defineEmits<{ currentScore: [] }>();
const shiftPlayback = (delta: number) => { const controls = props.playback; controls.shift(delta); };
const menuOpen = ref(false);
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const score = ref<InstanceType<typeof MusicScoreControl> | null>(null);
const visible = useHeaderVisibility();

function close(restoreFocus = false) {
  menuOpen.value = false;
  if (restoreFocus) trigger.value?.focus();
}
function select(action: () => void) {
  close(true);
  action();
}
async function openMenu(last = false) {
  expanded.value = false;
  menuOpen.value = true;
  await nextTick();
  const items = root.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
  items?.[last ? items.length - 1 : 0]?.focus();
}
function toggleMenu() {
  if (menuOpen.value) close();
  else void openMenu();
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
  // Safari blurs a focused menu item before a pointer click without focusing
  // the clicked button. Keep it mounted so that click can still be delivered.
  if (event.relatedTarget instanceof Node && !root.value?.contains(event.relatedTarget)) close();
}
onMounted(() => document.addEventListener("pointerdown", outside));
onBeforeUnmount(() => document.removeEventListener("pointerdown", outside));
</script>

<template>
  <div ref="root" class="listen-control music-player-control" data-music-player @keydown="keydown" @focusout="focusout">
    <button ref="trigger" class="icon-btn music-player-trigger" type="button" :class="{ spinning: playback.playing.value && visible, active: menuOpen }" aria-label="听" title="听" aria-haspopup="menu" :aria-expanded="menuOpen" @click.stop="toggleMenu" @keydown.down.stop.prevent="openMenu()" @keydown.up.stop.prevent="openMenu(true)">
      <span class="music-player-glyph" aria-hidden="true">听</span>
    </button>
    <AppMenu v-if="menuOpen" class="listen-menu" label="听" @click.stop>
      <div class="listen-playback" :class="{ 'motion-paused': !visible }" role="group" aria-label="播放器">
        <div class="listen-current"><Headphones :size="15" /><OverflowMarquee :text="playback.title.value" /></div>
        <div class="listen-transport">
          <button type="button" role="menuitem" aria-label="上一曲" :disabled="!playback.canShift(-1)" @click="shiftPlayback(-1)"><SkipBack :size="18" /></button>
          <button type="button" role="menuitem" :aria-label="playback.playing.value ? '暂停' : '播放'" :disabled="!playback.available.value" @click="playback.toggle"><Pause v-if="playback.playing.value" :size="19" /><Play v-else :size="19" /></button>
          <button type="button" role="menuitem" aria-label="下一曲" :disabled="!playback.canShift(1)" @click="shiftPlayback(1)"><SkipForward :size="18" /></button>
        </div>
      </div>
      <AppMenuItem @click="select(props.openMusic)"><Music :size="17" /><span>赞美诗</span></AppMenuItem>
      <AppMenuItem @click="select(() => score?.open())"><span class="score-glyph" aria-hidden="true">谱</span><span>歌谱</span></AppMenuItem>
      <AppMenuItem @click="select(props.openFriend)"><Radio :size="17" /><span>良友电台</span></AppMenuItem>
    </AppMenu>
    <MusicMiniPanel v-if="expanded" :player="musicPlayer" :favorite-tracks="favoriteTracks" :playlists="playlists" :sleep-timer="sleepTimer" :font-size="fontSize" @close="expanded = false" @toggle-favorite="toggleFavorite" @open-manager="openManager" />
    <MusicScoreControl ref="score" hide-trigger :current-score-available="currentScoreAvailable" :current-channel-id="currentChannelId" @current="emit('currentScore')" />
  </div>
</template>

<style scoped>
.listen-control { position: relative; }
.listen-menu { position: absolute; top: calc(100% + 8px); right: 0; z-index: 44; width: min(238px, calc(100vw - 24px)); min-width: 0; }
.listen-playback { min-width: 0; max-width: 100%; padding: 8px 6px 12px; border-bottom: 1px solid var(--line); margin-bottom: 3px; }
.listen-current { display: flex; min-width: 0; align-items: center; gap: 7px; color: var(--muted); font-size: 12px; }
.listen-current svg { flex-shrink: 0; }
.listen-current :deep(.overflow-marquee) { flex: 1; width: 0; min-width: 0; font: inherit; line-height: 1.6; }
.motion-paused :deep(.overflow-marquee-track) { animation-play-state: paused; }
.listen-transport { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); min-width: 0; gap: 10px; margin-top: 10px; padding: 0 1px; }
.listen-transport button { position: relative; display: grid; place-items: center; width: 100%; min-width: 0; max-width: 100%; height: 42px; padding: 0; border: 1px solid color-mix(in srgb, var(--panel) 80%, #b4c2d9); border-radius: 13px; background: linear-gradient(155deg, #fff9, #ffffff18 48%, #a6b7d226), color-mix(in srgb, var(--panel) 54%, transparent); color: var(--text); box-shadow: inset 0 1px 1px #fff, inset 0 -1px 2px #8d9aaf30, 0 3px 6px #1e30451a; backdrop-filter: blur(14px) saturate(150%); -webkit-backdrop-filter: blur(14px) saturate(150%); cursor: pointer; touch-action: manipulation; transition: transform 100ms ease, box-shadow 100ms ease, background-color 100ms ease; }
.listen-transport button::before { content: ''; position: absolute; top: 2px; left: 5px; right: 5px; height: 42%; border-radius: 9px 9px 50% 50%; background: linear-gradient(#ffffff6e, #ffffff05); pointer-events: none; }
.listen-transport button svg { position: relative; width: 18px; height: 18px; filter: drop-shadow(0 1px 0 #ffffff88); pointer-events: none; }
.listen-transport button:hover:not(:disabled) { background-color: color-mix(in srgb, var(--accent) 10%, transparent); }
.listen-transport button:active:not(:disabled) { transform: translateY(2px) scale(.95); box-shadow: inset 0 2px 5px #22334d29, inset 0 -1px 1px #ffffffb3, 0 1px 2px #22334d14; }
.listen-transport button:disabled { opacity: .4; cursor: default; box-shadow: inset 0 1px 1px #ffffff80; }
.listen-transport button:focus-visible { outline: 2px solid var(--accent); }
.score-glyph { width: 17px; font-size: 16px; text-align: center; }
</style>
