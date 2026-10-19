<script setup lang="ts">
// 有声圣经顶栏控件：上一章 | 上一节 | 播放/暂停 | 下一节 | 下一章 + 章内进度条（可拖 seek）+ 速率 + 跟随翻页。
// 纯展示组件：状态来自 props，动作通过 emit 交给工作区里的播放器。
import { computed, ref } from "vue";
import { ChevronFirst, ChevronLast, Headphones, LoaderCircle, Locate, LocateOff, Pause, Play, SkipBack, SkipForward, X } from "lucide-vue-next";

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
  resumeLabel?: string | null;
  error?: string;
}>(), {
  loading: false,
  canPreviousChapter: false,
  canNextChapter: false,
  compact: false,
  followEnabled: true,
  resumeLabel: null,
  error: ""
});

const emit = defineEmits<{
  toggle: [];
  "previous-verse": [];
  "next-verse": [];
  "previous-chapter": [];
  "next-chapter": [];
  seek: [ms: number];
  "cycle-rate": [];
  "toggle-follow": [];
  resume: [];
  stop: [];
}>();

const dragging = ref(false);
const dragValue = ref(0);

const shownPositionMs = computed(() => (dragging.value ? dragValue.value : props.positionMs));
const progressPercent = computed(() => (props.durationMs > 0 ? Math.min(100, Math.max(0, (shownPositionMs.value / props.durationMs) * 100)) : 0));
const rateLabel = computed(() => `${Number.isInteger(props.rate) ? props.rate.toFixed(1) : String(props.rate)}×`);

function formatTime(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function handleSeekInput(event: Event) {
  dragging.value = true;
  dragValue.value = Number((event.target as HTMLInputElement).value);
}

function handleSeekCommit(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  dragging.value = false;
  emit("seek", value);
}
</script>

<template>
  <div class="bible-audio-controls" :class="{ compact, active, playing }" role="group" aria-label="有声圣经播放控制">
    <div v-if="compact && active" class="bible-audio-thinline" aria-hidden="true"><span :style="{ width: `${progressPercent}%` }"></span></div>
    <div class="bible-audio-buttons">
      <button v-if="!compact" type="button" class="bible-audio-button" :disabled="!active || !canPreviousChapter" aria-label="上一章" title="上一章" @click="emit('previous-chapter')"><ChevronFirst :size="18" /></button>
      <button type="button" class="bible-audio-button" :disabled="!active" aria-label="上一节" title="上一节" @click="emit('previous-verse')"><SkipBack :size="17" /></button>
      <button type="button" class="bible-audio-button primary" :aria-label="playing ? '暂停朗读' : '播放朗读'" :title="playing ? '暂停' : '播放'" @click="emit('toggle')">
        <LoaderCircle v-if="loading && playing" :size="20" class="bible-audio-spin" />
        <Pause v-else-if="playing" :size="20" />
        <Play v-else :size="20" />
      </button>
      <button type="button" class="bible-audio-button" :disabled="!active" aria-label="下一节" title="下一节" @click="emit('next-verse')"><SkipForward :size="17" /></button>
      <button v-if="!compact" type="button" class="bible-audio-button" :disabled="!active || !canNextChapter" aria-label="下一章" title="下一章" @click="emit('next-chapter')"><ChevronLast :size="18" /></button>
    </div>
    <div class="bible-audio-track">
      <div class="bible-audio-meta">
        <span class="bible-audio-reference" :class="{ error: !!error }">
          <Headphones v-if="!active && !error" :size="14" aria-hidden="true" />
          <template v-if="error">{{ error }}</template>
          <template v-else-if="active">{{ reference }}</template>
          <template v-else>有声圣经</template>
        </span>
        <button v-if="!active && resumeLabel" type="button" class="bible-audio-resume" @click="emit('resume')">{{ resumeLabel }}</button>
        <span v-if="active" class="bible-audio-time">{{ formatTime(shownPositionMs) }} / {{ formatTime(durationMs) }}</span>
      </div>
      <input
        v-if="!compact"
        type="range"
        class="bible-audio-progress"
        min="0"
        :max="Math.max(1, durationMs)"
        step="250"
        :value="shownPositionMs"
        :disabled="!active || durationMs <= 0"
        aria-label="章内进度"
        :aria-valuetext="`${formatTime(shownPositionMs)} / ${formatTime(durationMs)}`"
        @input="handleSeekInput"
        @change="handleSeekCommit"
      />
    </div>
    <div class="bible-audio-extras">
      <button type="button" class="bible-audio-rate" :aria-label="`播放速率 ${rateLabel}，点击切换`" :title="`速率 ${rateLabel}`" @click="emit('cycle-rate')">{{ rateLabel }}</button>
      <button type="button" class="bible-audio-button" :class="{ on: followEnabled }" :aria-pressed="followEnabled" :aria-label="followEnabled ? '关闭跟随翻页' : '开启跟随翻页'" :title="followEnabled ? '跟随翻页：开' : '跟随翻页：关'" @click="emit('toggle-follow')">
        <Locate v-if="followEnabled" :size="16" />
        <LocateOff v-else :size="16" />
      </button>
      <button v-if="active" type="button" class="bible-audio-button" aria-label="停止朗读" title="停止" @click="emit('stop')"><X :size="16" /></button>
    </div>
  </div>
</template>

<style scoped>
.bible-audio-controls {
  position: relative;
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 4px 0 6px;
  border-top: 1px solid rgba(104, 76, 45, .12);
  color: #5d4a33;
}
.bible-audio-buttons, .bible-audio-extras { display: inline-flex; align-items: center; gap: 2px; }
.bible-audio-button {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 34px; min-height: 34px; padding: 0; border: 0; border-radius: 999px;
  background: transparent; color: #725537; cursor: pointer; font: inherit;
}
.bible-audio-button:disabled { opacity: .35; cursor: default; }
.bible-audio-button:not(:disabled):hover { background: rgba(114, 85, 55, .1); }
.bible-audio-button.primary { min-width: 40px; min-height: 40px; color: #fff; background: #c2733a; box-shadow: 0 4px 12px rgba(194, 115, 58, .32); }
.bible-audio-button.primary:not(:disabled):hover { background: #ad6530; }
.bible-audio-button.on { color: #c2733a; background: rgba(194, 115, 58, .12); }
.bible-audio-spin { animation: bible-audio-spin 1s linear infinite; }
@keyframes bible-audio-spin { to { transform: rotate(360deg); } }
.bible-audio-track { display: grid; gap: 2px; min-width: 0; }
.bible-audio-meta { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; min-width: 0; font-size: 13px; }
.bible-audio-reference { display: inline-flex; align-items: center; gap: 5px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; }
.bible-audio-controls.active .bible-audio-reference { color: #c2733a; }
.bible-audio-reference.error { color: #b42318; }
.bible-audio-time { flex: none; font-variant-numeric: tabular-nums; color: #8a7557; }
.bible-audio-resume { flex: none; border: 1px solid rgba(194, 115, 58, .45); border-radius: 999px; padding: 2px 10px; background: rgba(255, 255, 255, .6); color: #a85f2a; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
.bible-audio-progress { width: 100%; height: 18px; margin: 0; accent-color: #c2733a; cursor: pointer; }
.bible-audio-progress:disabled { cursor: default; opacity: .5; }
.bible-audio-rate { min-width: 44px; min-height: 30px; padding: 0 8px; border: 1px solid rgba(114, 85, 55, .28); border-radius: 999px; background: transparent; color: #725537; font: inherit; font-size: 12px; font-weight: 800; font-variant-numeric: tabular-nums; cursor: pointer; }
.bible-audio-rate:hover { background: rgba(114, 85, 55, .1); }

/* 窄屏：收起上一章/下一章，进度条变成贴顶 3px 细线 */
.bible-audio-controls.compact { gap: 6px; padding-top: 7px; }
.bible-audio-thinline { position: absolute; left: 0; right: 0; top: 0; height: 3px; background: rgba(194, 115, 58, .18); overflow: hidden; }
.bible-audio-thinline span { display: block; height: 100%; background: #f97316; transition: width 240ms linear; }
.bible-audio-controls.compact .bible-audio-meta { font-size: 12px; }
.bible-audio-controls.compact .bible-audio-button { min-width: 30px; min-height: 30px; }
.bible-audio-controls.compact .bible-audio-button.primary { min-width: 36px; min-height: 36px; }
</style>
