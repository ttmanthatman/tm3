<script setup lang="ts">
// 有声圣经顶栏控件（仅在播放会话中渲染）：上一章 | 上一节 | 播放/暂停 | 下一节 | 下一章 + 参考/时间 + 速率 + 跟随翻页。
// 始终内联在顶栏第一行（居中于关闭按钮与右侧操作组之间）；紧凑时按钮缩小并随宽度收窄细节，不新增行。
// 播放键长按 = 切换「连播到底」（按钮变绿、暂停态显示三角带箭头图标），再长按切回；短按仍是暂停/继续。
import { computed } from "vue";
import { ChevronFirst, ChevronLast, LoaderCircle, Locate, LocateOff, Pause, Play, SkipBack, SkipForward } from "lucide-vue-next";
import BiblePlayThroughIcon from "./BiblePlayThroughIcon.vue";
import { useLongPressAction } from "./useLongPressAction";

const props = withDefaults(defineProps<{
  active: boolean;
  playing: boolean;
  loading?: boolean;
  positionMs: number;
  durationMs: number;
  rate: number;
  reference: string;
  canPreviousChapter?: boolean;
  canNextChapter?: boolean;
  compact?: boolean;
  followEnabled?: boolean;
  playThrough?: boolean;
  error?: string;
}>(), {
  loading: false,
  canPreviousChapter: false,
  canNextChapter: false,
  compact: false,
  followEnabled: true,
  playThrough: false,
  error: ""
});

const emit = defineEmits<{
  toggle: [];
  "previous-verse": [];
  "next-verse": [];
  "previous-chapter": [];
  "next-chapter": [];
  "cycle-rate": [];
  "toggle-follow": [];
  "toggle-play-through": [];
}>();

const playThroughPress = useLongPressAction(() => emit("toggle-play-through"));

function handlePlayClick() {
  if (playThroughPress.consumeClick()) return;
  emit("toggle");
}

const rateLabel = computed(() => `${Number.isInteger(props.rate) ? props.rate.toFixed(1) : String(props.rate)}×`);

function formatTime(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
</script>

<template>
  <div class="bible-audio-controls" :class="{ compact, active, playing }" role="group" aria-label="有声圣经播放控制">
    <div class="bible-audio-buttons">
      <button v-if="!compact" type="button" class="bible-audio-button chapter-nav" :disabled="!active || !canPreviousChapter" aria-label="上一章" title="上一章" @click="emit('previous-chapter')"><ChevronFirst :size="17" /></button>
      <button type="button" class="bible-audio-button" :disabled="!active" aria-label="上一节" title="上一节" @click="emit('previous-verse')"><SkipBack :size="16" /></button>
      <button
        type="button"
        class="bible-audio-button primary"
        :class="{ through: playThrough }"
        :aria-label="playing ? '暂停朗读' : playThrough ? '连播到底，点击继续朗读' : '播放朗读'"
        :title="playThrough ? '连播到底（长按切回选段朗读）' : playing ? '暂停' : '播放'"
        @pointerdown="playThroughPress.down"
        @pointermove="playThroughPress.move"
        @pointerup="playThroughPress.clear"
        @pointercancel="playThroughPress.clear"
        @pointerleave="playThroughPress.clear"
        @contextmenu.prevent
        @click="handlePlayClick"
      >
        <LoaderCircle v-if="loading && playing" :size="19" class="bible-audio-spin" />
        <Pause v-else-if="playing" :size="19" />
        <BiblePlayThroughIcon v-else-if="playThrough" :size="19" />
        <Play v-else :size="19" />
      </button>
      <button type="button" class="bible-audio-button" :disabled="!active" aria-label="下一节" title="下一节" @click="emit('next-verse')"><SkipForward :size="16" /></button>
      <button v-if="!compact" type="button" class="bible-audio-button chapter-nav" :disabled="!active || !canNextChapter" aria-label="下一章" title="下一章" @click="emit('next-chapter')"><ChevronLast :size="17" /></button>
    </div>
    <!-- 参考与时间；宽屏才显示（容器查询逐级恢复） -->
    <div class="bible-audio-track">
      <span class="bible-audio-reference" :class="{ error: !!error }">{{ error || reference }}</span>
      <span class="bible-audio-time">{{ formatTime(positionMs) }} / {{ formatTime(durationMs) }}</span>
    </div>
    <div class="bible-audio-extras">
      <button type="button" class="bible-audio-rate" :aria-label="`播放速率 ${rateLabel}，点击切换`" :title="`速率 ${rateLabel}`" @click="emit('cycle-rate')">{{ rateLabel }}</button>
      <button type="button" class="bible-audio-button" :class="{ on: followEnabled }" :aria-pressed="followEnabled" :aria-label="followEnabled ? '关闭跟随翻页' : '开启跟随翻页'" :title="followEnabled ? '跟随翻页：开' : '跟随翻页：关'" @click="emit('toggle-follow')">
        <Locate v-if="followEnabled" :size="15" />
        <LocateOff v-else :size="15" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.bible-audio-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 44px;
  color: #5d4a33;
}
.bible-audio-buttons, .bible-audio-extras { display: inline-flex; align-items: center; gap: 2px; min-width: 0; }
.bible-audio-button {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 30px; min-height: 30px; padding: 0; border: 0; border-radius: 999px;
  background: transparent; color: #725537; cursor: pointer; font: inherit;
}
.bible-audio-button:disabled { opacity: .35; cursor: default; }
.bible-audio-button:not(:disabled):hover { background: rgba(114, 85, 55, .1); }
.bible-audio-button.primary { min-width: 36px; min-height: 36px; color: #fff; background: #c2733a; box-shadow: 0 4px 12px rgba(194, 115, 58, .32); }
.bible-audio-button.primary:not(:disabled):hover { background: #ad6530; }
/* 连播到底：绿色标识 */
.bible-audio-button.primary.through { background: #2f9e44; box-shadow: 0 4px 12px rgba(47, 158, 68, .32); }
.bible-audio-button.primary.through:not(:disabled):hover { background: #268a3b; }
.bible-audio-button.on { color: #c2733a; background: rgba(194, 115, 58, .12); }
.bible-audio-spin { animation: bible-audio-spin 1s linear infinite; }
@keyframes bible-audio-spin { to { transform: rotate(360deg); } }
.bible-audio-reference { display: inline-flex; align-items: center; gap: 5px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 700; }
.bible-audio-controls.active .bible-audio-reference { color: #c2733a; }
.bible-audio-reference.error { color: #b42318; }
.bible-audio-time { flex: none; font-size: 11px; font-variant-numeric: tabular-nums; color: #8a7557; }
.bible-audio-rate { flex: none; min-width: 42px; min-height: 28px; padding: 0 7px; border: 1px solid rgba(114, 85, 55, .28); border-radius: 999px; background: transparent; color: #725537; font: inherit; font-size: 12px; font-weight: 800; font-variant-numeric: tabular-nums; cursor: pointer; }
.bible-audio-rate:hover { background: rgba(114, 85, 55, .1); }
.bible-audio-track { display: flex; align-items: center; gap: 7px; min-width: 0; }

/* 顶栏较窄时内联条保持精简：先藏参考文字，再藏章节按钮与时间；
   容器（.bible-topbar）变宽时逐级恢复。容器查询不可用时停留在精简形态。 */
.bible-audio-controls .chapter-nav { display: none; }
.bible-audio-controls .bible-audio-time { display: none; }
.bible-audio-controls .bible-audio-track .bible-audio-reference { display: none; }
@container bible-topbar (min-width: 780px) {
  .bible-audio-controls .chapter-nav { display: inline-flex; }
  .bible-audio-controls .bible-audio-time { display: inline; }
}
@container bible-topbar (min-width: 1080px) {
  .bible-audio-controls .bible-audio-track .bible-audio-reference { display: inline-flex; }
}

/* 紧凑（窄屏）：与关闭键、右侧操作组共享顶栏第一行，按钮整体缩小，参考/时间不留单行空间 */
.bible-audio-controls.compact {
  position: relative;
  flex-wrap: nowrap;
  gap: 4px;
  min-height: 40px;
  padding: 0;
}
.bible-audio-controls.compact .bible-audio-button { min-width: 28px; min-height: 30px; }
.bible-audio-controls.compact .bible-audio-button.primary { min-width: 34px; min-height: 34px; }
.bible-audio-controls.compact .bible-audio-rate { min-width: 38px; min-height: 26px; padding: 0 6px; }
.bible-audio-controls.compact .bible-audio-track { display: none; }
/* 顶栏极窄时先收跟随键、再收速率键，保住单行不换行 */
@container bible-topbar (max-width: 379px) {
  .bible-audio-controls.compact .bible-audio-extras .bible-audio-button { display: none; }
}
@container bible-topbar (max-width: 329px) {
  .bible-audio-controls.compact .bible-audio-rate { display: none; }
}
</style>
