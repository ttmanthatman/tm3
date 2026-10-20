<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { BookOpen, ChevronFirst, ChevronLast, Headphones, Music2, Pause, Play, SkipBack, SkipForward } from "lucide-vue-next";
import type { BibleLookupDTO } from "@shared/types";
import { listenPlaylistCountLabel, listenPlaylistItemLabel, type ListenPlaylistPayload, type ListenScriptureItem } from "@shared/listenPlaylist";
import { api } from "../../api";
import ReadingShareCard from "../reading-shares/ReadingShareCard.vue";
import type { ListenSessionSnapshot } from "./useListenSession";

// 「/听」清单卡片：按顺序列出经文段与歌曲，正在播放的一项橙色加粗；
// 经文播放时在清单下方滚出当前经节正文（正文走消息里共用的经文查询缓存）。
// 播放状态与控制全部来自 App 的 useListenSession，卡片本身不碰播放器。
const props = defineProps<{
  playlist: ListenPlaylistPayload;
  /** 这条消息正在播放时的会话快照；其他消息在播或空闲时为 null */
  session: ListenSessionSnapshot | null;
  scope: string | number;
  bibleReferenceLookup: (scope: string | number, reference: string) => BibleLookupDTO | null | undefined;
  ensureBibleReferenceLookup: (scope: string | number, reference: string) => void;
  openPassage: (lookup: BibleLookupDTO) => Promise<void>;
  paperSeed?: string | number;
}>();

const emit = defineEmits<{
  toggle: [];
  "play-item": [index: number];
  "previous-verse": [];
  "next-verse": [];
  "previous-chapter": [];
  "next-chapter": [];
}>();

const jumpBusy = ref("");
const error = ref("");

const countLabel = computed(() => listenPlaylistCountLabel(props.playlist.items));
const currentItem = computed(() => (props.session ? props.playlist.items[props.session.index] || null : null));
const scripturePlaying = computed(() => props.session?.phase === "scripture" && currentItem.value?.kind === "scripture");

watch(() => (scripturePlaying.value && currentItem.value?.kind === "scripture" ? currentItem.value.reference : ""), (reference) => {
  if (reference) props.ensureBibleReferenceLookup(props.scope, reference);
}, { immediate: true });

const currentVerseText = computed(() => {
  const session = props.session;
  const item = currentItem.value;
  if (!session || !item || item.kind !== "scripture" || session.phase !== "scripture") return "";
  if (session.verse === null || session.verse <= 0) return session.chapter ? `${item.bookName} ${session.chapter} 章 · 引言` : "";
  const lookup = props.bibleReferenceLookup(props.scope, item.reference);
  const line = lookup?.verses.find((verse) => verse.chapter === (session.chapter ?? verse.chapter) && verse.verse <= session.verse! && session.verse! <= verse.endVerse);
  return line?.text || "";
});

function versePosition(index: number) {
  const session = props.session;
  if (!session || session.index !== index || session.phase !== "scripture" || session.verse === null) return "";
  if (session.verse <= 0) return "引言";
  const item = props.playlist.items[index];
  const spansChapters = item?.kind === "scripture" && item.startChapter !== item.endChapter;
  return spansChapters && session.chapter ? `${session.chapter}:${session.verse}` : `第 ${session.verse} 节`;
}

async function jump(item: ListenScriptureItem) {
  if (jumpBusy.value) return;
  jumpBusy.value = item.reference;
  error.value = "";
  try {
    const response = await api<{ success: boolean; result?: BibleLookupDTO; message?: string }>(
      `/api/bible/lookup?reference=${encodeURIComponent(item.reference)}`
    );
    if (!response.success || !response.result?.verses.length) throw new Error(response.message || "暂时找不到这处经文");
    await props.openPassage(response.result);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "经文打开失败，请重试";
  } finally {
    jumpBusy.value = "";
  }
}
</script>

<template>
  <ReadingShareCard kind="bible" :paper-seed="paperSeed" class="listen-card" :class="{ active: !!session, playing: !!session?.playing }">
    <header class="listen-card-head">
      <span class="listen-card-kicker"><Headphones :size="15" />一起听</span>
      <small>{{ countLabel }} · {{ playlist.translation }}</small>
      <p v-if="playlist.note" class="listen-card-note">{{ playlist.note }}</p>
    </header>
    <ol class="listen-card-list">
      <li
        v-for="(item, index) in playlist.items"
        :key="`${index}-${item.kind === 'track' ? item.trackId : item.reference}`"
        class="listen-card-row"
        :class="{ current: session?.index === index, track: item.kind === 'track' }"
      >
        <button
          type="button"
          class="listen-card-item"
          :aria-label="`${session?.index === index ? (session?.playing ? '暂停' : '继续') : '播放'} ${listenPlaylistItemLabel(item)}`"
          :aria-current="session?.index === index ? 'true' : undefined"
          @click.stop="emit('play-item', index)"
          @pointerdown.stop
        >
          <span class="listen-card-index" aria-hidden="true">
            <template v-if="session?.index === index">
              <Pause v-if="session?.playing" :size="12" fill="currentColor" />
              <Play v-else :size="12" fill="currentColor" />
            </template>
            <template v-else>{{ index + 1 }}</template>
          </span>
          <Music2 v-if="item.kind === 'track'" :size="13" class="listen-card-kind" aria-hidden="true" />
          <span class="listen-card-label">{{ listenPlaylistItemLabel(item) }}</span>
          <small v-if="versePosition(index)" class="listen-card-verse">{{ versePosition(index) }}</small>
        </button>
        <button
          v-if="item.kind === 'scripture'"
          type="button"
          class="listen-card-open"
          title="在圣经中阅读"
          :aria-label="`在圣经中阅读 ${item.reference}`"
          :disabled="jumpBusy !== ''"
          @click.stop="jump(item)"
          @pointerdown.stop
        >
          <BookOpen :size="14" />
        </button>
      </li>
    </ol>
    <Transition name="listen-card-prompt">
      <p v-if="currentVerseText" :key="currentVerseText" class="listen-card-prompt">{{ currentVerseText }}</p>
    </Transition>
    <div class="listen-card-controls" role="group" aria-label="播放清单控制" @click.stop @pointerdown.stop>
      <button type="button" class="listen-card-button" :disabled="!session" aria-label="上一章" title="上一章" @click="emit('previous-chapter')"><ChevronFirst :size="18" /></button>
      <button type="button" class="listen-card-button" :disabled="!scripturePlaying" aria-label="上一节" title="上一节" @click="emit('previous-verse')"><SkipBack :size="16" /></button>
      <button type="button" class="listen-card-button listen-card-play" :aria-label="session?.playing ? '暂停' : '播放'" :title="session?.playing ? '暂停' : '播放'" @click="emit('toggle')">
        <Pause v-if="session?.playing" :size="20" fill="currentColor" />
        <Play v-else :size="20" fill="currentColor" />
      </button>
      <button type="button" class="listen-card-button" :disabled="!scripturePlaying" aria-label="下一节" title="下一节" @click="emit('next-verse')"><SkipForward :size="16" /></button>
      <button type="button" class="listen-card-button" :disabled="!session" aria-label="下一章" title="下一章" @click="emit('next-chapter')"><ChevronLast :size="18" /></button>
    </div>
    <p v-if="error" class="reading-share-error" role="alert">{{ error }}</p>
  </ReadingShareCard>
</template>

<style scoped>
.listen-card {
  max-width: 100%;
}
.listen-card-head {
  display: grid;
  gap: 3px;
}
.listen-card-kicker {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #95704a;
  font-size: 12px;
  font-weight: 700;
}
.listen-card-head small {
  color: #92775b;
}
.listen-card-note {
  margin: 6px 0 0;
  color: #5c4a36;
  font-size: var(--message-content-font-size, 15px);
  white-space: pre-wrap;
}
.listen-card-list {
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 1px;
  max-height: 360px;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: #cbb797 transparent;
}
.listen-card-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  border-radius: 8px;
  transition: background-color 0.25s ease;
}
.listen-card-row.current {
  background: rgba(249, 115, 22, 0.08);
}
.listen-card-item {
  min-width: 0;
  min-height: 36px;
  border: 0;
  padding: 4px 6px 4px 2px;
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  color: #76502d;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.listen-card-row.track .listen-card-item {
  grid-template-columns: 22px auto minmax(0, 1fr) auto;
}
.listen-card-item:hover .listen-card-label {
  color: #5c3f1f;
}
.listen-card-item:focus-visible {
  outline: 2px solid #527bb3;
  outline-offset: 2px;
}
.listen-card-index {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  color: #a08564;
  background: rgba(118, 80, 45, 0.08);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.listen-card-kind {
  color: #a08564;
}
.listen-card-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--message-content-font-size, 16px);
  font-weight: 600;
  transition: color 0.25s ease;
}
.listen-card-verse {
  color: #b9582b;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
/* 正在播放的一项：橙色加粗，与圣经阅读器里的朗读高亮同色 */
.listen-card-row.current .listen-card-label,
.listen-card-row.current .listen-card-verse,
.listen-card-row.current .listen-card-kind {
  color: #f97316;
  font-weight: 700;
}
.listen-card-row.current .listen-card-index {
  color: #fff;
  background: #f97316;
}
.listen-card-open {
  border: 0;
  padding: 6px;
  display: inline-flex;
  color: #a08564;
  background: transparent;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.2s ease, color 0.2s ease;
}
.listen-card-row:hover .listen-card-open,
.listen-card-row.current .listen-card-open,
.listen-card-open:focus-visible {
  opacity: 1;
}
.listen-card-open:hover {
  color: #5c3f1f;
}
.listen-card-open:disabled {
  opacity: 0.45;
  cursor: wait;
}
@media (hover: none) {
  .listen-card-open {
    opacity: 1;
  }
}
.listen-card-prompt {
  margin: 10px 2px 0;
  padding: 8px 12px;
  border-left: 3px solid #f97316;
  color: #4a3a28;
  background: rgba(249, 115, 22, 0.06);
  font-family: "Songti SC", "STSong", serif;
  font-size: var(--message-content-font-size, 16px);
  line-height: 1.7;
}
.listen-card-prompt-enter-active,
.listen-card-prompt-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.listen-card-prompt-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
.listen-card-prompt-leave-to {
  opacity: 0;
}
.listen-card-prompt-leave-active {
  position: absolute;
  pointer-events: none;
}
.listen-card-controls {
  margin-top: 12px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 6px;
}
.listen-card-button {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  width: 38px;
  height: 38px;
  border: 1px solid rgba(118, 80, 45, 0.22);
  border-radius: 50%;
  color: #76502d;
  background: rgba(255, 252, 245, 0.9);
  cursor: pointer;
  transition: background-color 0.2s ease, color 0.2s ease, transform 0.15s ease;
}
.listen-card-button:hover:not(:disabled) {
  background: #fff;
  color: #5c3f1f;
}
.listen-card-button:active:not(:disabled) {
  transform: scale(0.94);
}
.listen-card-button:disabled {
  opacity: 0.35;
  cursor: default;
}
.listen-card-button:focus-visible {
  outline: 2px solid #527bb3;
  outline-offset: 2px;
}
.listen-card-play {
  width: 48px;
  height: 48px;
  border-color: transparent;
  color: #fff;
  background: #b9582b;
  box-shadow: 0 6px 16px rgba(185, 88, 43, 0.28);
}
.listen-card-play:hover:not(:disabled) {
  background: #a84d23;
  color: #fff;
}
.listen-card.playing .listen-card-play {
  background: #f97316;
  box-shadow: 0 6px 16px rgba(249, 115, 22, 0.32);
}
.listen-card.playing .listen-card-play:hover:not(:disabled) {
  background: #ea6a0f;
}
</style>
