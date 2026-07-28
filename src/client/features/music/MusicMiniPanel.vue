<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import {
  ChevronLeft,
  ChevronRight,
  Heart,
  ListMusic,
  Maximize2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  Timer,
  X
} from "lucide-vue-next";
import type { MusicPlaybackModeDTO, MusicPlaylistDTO, MusicPlaylistSourceKind, MusicTrackDTO } from "../../../shared/types";
import OverflowMarquee from "../../components/OverflowMarquee.vue";
import type { MusicPlayer } from "./useMusicPlayer";
import type { MusicSleepTimer } from "./useMusicSleepTimer";

const props = defineProps<{
  player: MusicPlayer;
  favoriteTracks: MusicTrackDTO[];
  playlists: MusicPlaylistDTO[];
  sleepTimer: MusicSleepTimer;
  fontSize: number;
}>();
const emit = defineEmits<{
  close: [];
  "toggle-favorite": [track: MusicTrackDTO];
  "open-manager": [];
}>();

const { currentTrack, currentTrackId, playableTracks, playbackMode, playbackSourceKind, playbackSourceName, playbackPlaylistId, playing, loading, error } = props.player.state;
const controls = props.player.controls;
const { kind: timerKind, label: timerLabel } = props.sleepTimer.state;

const title = computed(() => currentTrack.value?.title || "歌单还是空的");
const titleScrolling = computed(() => Array.from(title.value).length > 14);

const queue = computed(() => playableTracks.value);

const modeIcons: Record<MusicPlaybackModeDTO, typeof Repeat> = {
  playlist: Repeat,
  shuffle: Shuffle,
  single: Repeat1
};
const modes: MusicPlaybackModeDTO[] = ["playlist", "shuffle", "single"];

const panelStyle = computed(() => ({ fontSize: `${props.fontSize}px` }));

const sourcePickerOpen = ref(false);
const sourceOptions = computed(() => {
  const options: { kind: MusicPlaylistSourceKind; playlistId: number | null; name: string; count: number }[] = [
    { kind: "library", playlistId: null, name: "聊天室曲库", count: -1 },
    { kind: "favorites", playlistId: null, name: "收藏的曲目", count: props.favoriteTracks.length }
  ];
  for (const playlist of props.playlists) {
    options.push({ kind: "playlist", playlistId: playlist.id, name: playlist.name, count: playlist.tracks.length });
  }
  return options;
});

function sourceOptionActive(option: { kind: MusicPlaylistSourceKind; playlistId: number | null }) {
  if (option.kind !== playbackSourceKind.value) return false;
  return option.kind !== "playlist" || option.playlistId === playbackPlaylistId.value;
}

function chooseSource(option: { kind: MusicPlaylistSourceKind; playlistId: number | null }) {
  sourcePickerOpen.value = false;
  controls.setPlaybackSource(option.kind, option.playlistId);
}

const currentSongProgress = ref(0);
function refreshSongProgress() {
  const durationMs = controls.currentPlaybackDurationMs();
  currentSongProgress.value = durationMs > 0 ? Math.min(100, Math.round((controls.currentPlaybackTimeMs() / durationMs) * 100)) : 0;
}
const progressTimer = window.setInterval(refreshSongProgress, 1000);
onBeforeUnmount(() => window.clearInterval(progressTimer));

const minutesInput = ref("");
const tracksInput = ref("");
const timerError = ref("");

function parsePositiveInt(raw: string, min: number, max: number) {
  const text = raw.trim();
  if (!text || !/^\d+$/.test(text)) return null;
  const value = Number(text);
  return value >= min && value <= max ? value : null;
}

function armMinutes() {
  const minutes = parsePositiveInt(minutesInput.value, 1, 720);
  if (minutes === null) {
    timerError.value = "请输入 1-720 之间的分钟数";
    return;
  }
  timerError.value = "";
  props.sleepTimer.controls.startMinutes(minutes);
}

function armTracks() {
  const count = parsePositiveInt(tracksInput.value, 1, 99);
  if (count === null) {
    timerError.value = "请输入 1-99 之间的首数";
    return;
  }
  timerError.value = "";
  props.sleepTimer.controls.startTracks(count);
}

function cancelTimer() {
  timerError.value = "";
  props.sleepTimer.controls.cancel();
}

function playTrack(track: MusicTrackDTO) {
  controls.selectTrack(track);
}
</script>

<template>
  <Teleport to="body">
    <div class="music-mini-backdrop" aria-hidden="true" @click="emit('close')"></div>
    <section class="music-mini-panel" data-music-player role="dialog" aria-label="音乐播放器" :style="panelStyle" @click.stop>
      <button class="icon-btn music-mini-panel-close" type="button" aria-label="关闭播放器" @click="emit('close')"><X :size="18" /></button>

      <div class="music-mini-panel-title">
        <strong class="music-title-viewport">
          <span class="music-title-track" :class="{ scrolling: titleScrolling }">
            <span>{{ title }}</span>
            <span v-if="titleScrolling" aria-hidden="true">{{ title }}</span>
          </span>
        </strong>
        <small v-if="error" class="music-mini-panel-status error">{{ error }}</small>
        <small v-else-if="loading" class="music-mini-panel-status">正在缓冲…</small>
        <small v-else-if="!playing && currentTrack" class="music-mini-panel-status">已暂停</small>
      </div>

      <div class="music-mini-panel-transport">
        <button class="icon-btn" type="button" :disabled="!playableTracks.length" aria-label="上一曲" @click="controls.shiftTrack(-1)"><ChevronLeft :size="20" /></button>
        <button class="icon-btn music-main-control" type="button" :disabled="!currentTrack" :aria-label="playing ? '暂停' : '播放'" @click="controls.togglePlayback()">
          <Pause v-if="playing" :size="21" />
          <Play v-else :size="21" />
        </button>
        <button
          class="icon-btn music-mini-panel-heart"
          type="button"
          :class="{ active: !!currentTrack?.favorited }"
          :disabled="!currentTrack"
          :aria-label="currentTrack?.favorited ? '取消收藏当前歌曲' : '收藏当前歌曲'"
          @click="currentTrack && emit('toggle-favorite', currentTrack)"
        ><Heart :size="19" :fill="currentTrack?.favorited ? 'currentColor' : 'none'" /></button>
        <button class="icon-btn" type="button" :disabled="!playableTracks.length" aria-label="下一曲" @click="controls.shiftTrack(1)"><ChevronRight :size="20" /></button>
      </div>

      <div class="music-mini-panel-modes" role="group" aria-label="播放方式">
        <button
          v-for="mode in modes"
          :key="mode"
          class="music-mini-panel-mode"
          type="button"
          :class="{ active: playbackMode === mode }"
          :aria-pressed="playbackMode === mode"
          @click="controls.setPlaybackMode(mode)"
        >
          <component :is="modeIcons[mode]" :size="14" />
          <OverflowMarquee :text="controls.playbackModeLabel(mode)" />
        </button>
      </div>

      <div class="music-mini-panel-section">
        <h4><Heart :size="13" />收藏的曲目</h4>
        <p v-if="!favoriteTracks.length" class="music-mini-panel-empty">还没有收藏歌曲</p>
        <ul v-else class="music-mini-panel-list">
          <li v-for="track in favoriteTracks" :key="track.id">
            <button
              class="music-mini-panel-track"
              type="button"
              :class="{ current: track.id === currentTrackId }"
              @click="playTrack(track)"
            >{{ track.title }}</button>
          </li>
        </ul>
      </div>

      <div class="music-mini-panel-section">
        <h4 class="music-mini-panel-source-head">
          <span class="music-mini-panel-source-name"><ListMusic :size="13" />{{ playbackSourceName }}</span>
          <button class="icon-btn music-mini-panel-expand" type="button" aria-label="打开歌单管理" title="打开歌单管理" @click="emit('open-manager')"><Maximize2 :size="13" /></button>
          <button class="music-source-switch" type="button" :aria-expanded="sourcePickerOpen" @click="sourcePickerOpen = !sourcePickerOpen">切换歌单</button>
        </h4>
        <p v-if="!queue.length" class="music-mini-panel-empty">播放队列是空的</p>
        <ul v-else class="music-mini-panel-list">
          <li v-for="track in queue" :key="track.id">
            <button
              class="music-mini-panel-track"
              type="button"
              :class="{ current: track.id === currentTrackId }"
              @click="playTrack(track)"
            >{{ track.title }}</button>
          </li>
        </ul>
      </div>

      <div class="music-mini-panel-section music-mini-panel-timer">
        <h4><Timer :size="13" />定时停止<small class="music-mini-panel-timer-hint">点击右边按钮开始计时</small></h4>
        <template v-if="timerKind === 'off'">
          <form class="music-mini-panel-timer-form" @submit.prevent="armMinutes">
            <input v-model="minutesInput" type="text" inputmode="numeric" placeholder="分钟" aria-label="几分钟后停止" />
            <button class="music-manager-btn" type="submit">分钟后停止</button>
          </form>
          <form class="music-mini-panel-timer-form" @submit.prevent="armTracks">
            <input v-model="tracksInput" type="text" inputmode="numeric" placeholder="首数" aria-label="播放几首后停止" />
            <button class="music-manager-btn" type="submit">首后停止</button>
          </form>
          <p v-if="timerError" class="music-mini-panel-status error" role="alert">{{ timerError }}</p>
        </template>
        <div v-else class="music-mini-panel-timer-active">
          <span>{{ timerLabel }}<template v-if="timerKind === 'tracks'"> · 本首已播 {{ currentSongProgress }}%</template></span>
          <button class="music-manager-btn" type="button" @click="cancelTimer">取消定时</button>
        </div>
      </div>
      <div v-if="sourcePickerOpen" class="music-source-picker" role="dialog" aria-label="切换歌单">
        <div class="music-source-picker-head">
          <strong>切换歌单</strong>
          <button class="icon-btn" type="button" aria-label="关闭歌单切换" @click="sourcePickerOpen = false"><X :size="16" /></button>
        </div>
        <ul class="music-source-picker-list">
          <li v-for="option in sourceOptions" :key="option.kind + ':' + (option.playlistId || 0)">
            <button
              class="music-source-option"
              type="button"
              :class="{ current: sourceOptionActive(option) }"
              @click="chooseSource(option)"
            >
              <span class="music-source-option-name">{{ option.name }}</span>
              <span v-if="option.count >= 0" class="music-source-option-count">{{ option.count }} 首</span>
            </button>
          </li>
        </ul>
      </div>
    </section>
  </Teleport>
</template>
