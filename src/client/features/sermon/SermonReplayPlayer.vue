<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from "vue";
import { api } from "../../api";
import type { SermonReplayInfo, SermonReplayFrame, BibleVerseLineDTO } from "@shared/types";
import SermonStage from "./SermonStage.vue";
import SermonContextPanel from "./SermonContextPanel.vue";
import { sermonDisplayAttrs, sermonDisplayStyle } from "./sermonDisplay";

const props = defineProps<{ replay: SermonReplayInfo }>();
defineEmits<{close: []}>();
const frames = ref<SermonReplayFrame[]>([]), index = ref(0), playing = ref(false), error = ref("");
const context = ref<BibleVerseLineDTO[]>([]);
const frame = computed(() => frames.value[index.value]);
let timer: ReturnType<typeof setTimeout> | undefined;
let remaining = 0, deadline = 0;
function pause() {
  if (playing.value) remaining = Math.max(0, deadline - performance.now());
  clearTimeout(timer);
  playing.value = false;
}
function readContext(verse: BibleVerseLineDTO) {
  pause();
  context.value = [verse];
}
function seek(i: number) {
  pause();
  context.value = [];
  index.value = i;
  remaining = (frames.value[i+1]?.at ?? props.replay.ended) - frames.value[i].at;
}
function play() {
  playing.value = true;
  deadline = performance.now() + remaining;
  timer = setTimeout(() => {
    if (index.value+1 >= frames.value.length) { pause(); seek(0); return; }
    seek(index.value+1);
    play();
  }, Math.max(0,remaining));
}
watch(() => props.replay, async (info, _, cleanup) => {
  let cancelled = false;
  cleanup(() => { cancelled = true; pause(); });
  frames.value = []; error.value = "";
  const result: SermonReplayFrame[] = [];
  try {
    for (let start=0; start<info.count && !cancelled; start+=8) {
      const batch = Array.from({length: Math.min(8,info.count-start)}, (_,i) => api<SermonReplayFrame>(`/api/sermon/replays/${info.id}/${start+i}`));
      result.push(...await Promise.all(batch));
    }
    if (!cancelled) { frames.value = result; seek(0); }
  } catch { if (!cancelled) error.value = "回放读取失败，请返回后重新打开。"; }
}, { immediate:true });
function pauseWhenHidden() { if (document.hidden) pause(); }
onMounted(() => document.addEventListener("visibilitychange", pauseWhenHidden));
onBeforeUnmount(() => { pause(); document.removeEventListener("visibilitychange", pauseWhenHidden); });
</script>
<template>
  <article class="replay-player">
    <header><strong>{{ replay.title }}</strong><button class="mini-btn secondary" @click="$emit('close')">返回</button></header>
    <template v-if="frame">
      <div class="sermon-overlay replay-screen" :style="sermonDisplayStyle(frame.display)" v-bind="sermonDisplayAttrs(frame.display)">
        <div class="sermon-overlay-card"><SermonStage :item="frame.item" enable-verse-hold @verse-hold="readContext" /></div>
      </div>
      <SermonContextPanel v-if="context.length" :verses="context" closeable @close="context=[]" />
      <footer><button class="mini-btn secondary" :disabled="!index" @click="seek(index-1)">上一步</button>
        <button class="mini-btn primary" @click="playing ? pause() : play()">{{ playing ? '暂停' : '按现场节奏播放' }}</button>
        <button class="mini-btn secondary" :disabled="index+1 >= frames.length" @click="seek(index+1)">下一步</button>
        <small>{{ index+1 }} / {{ frames.length }}</small></footer>
    </template>
    <p v-else>{{ error || '正在读取回放…' }}</p>
  </article>
</template>
<style scoped>
.replay-screen.sermon-overlay{position:relative;inset:auto;width:100%;height:min(54dvh,560px);overflow:auto}
.replay-player header,.replay-player footer{display:flex;align-items:center;justify-content:space-between;gap:6px;margin:10px 0;flex-wrap:wrap}
</style>
