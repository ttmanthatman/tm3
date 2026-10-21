<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Check, ChevronDown, ChevronUp, Copy, Pause, Play } from "lucide-vue-next";
import type { BibleLookupDTO } from "@shared/types";
import { api } from "../../api";
import ReadingShareCard from "../reading-shares/ReadingShareCard.vue";

const props = defineProps<{
  passages: { reference: string; text: string }[];
  title?: string;
  note?: string;
  copyText?: () => Promise<string>;
  translation?: string;
  showTranslation?: boolean;
  sourceId?: string;
  paperSeed?: string | number;
  openPassage: (lookup: BibleLookupDTO) => Promise<void>;
  play?: () => Promise<unknown> | void;
  playLabel?: string;
  playing?: boolean;
}>();
const emit = defineEmits<{ expand: [] }>();
const expanded = ref(false);
const jumpBusy = ref(false);
const playBusy = ref(false);
const copied = ref(false);
const error = ref("");
const collapsible = computed(() => props.passages.length > 2 || props.passages.some(passage => passage.text.length > 280));
const folded = computed(() => collapsible.value && !expanded.value);
const visiblePassages = computed(() => folded.value ? props.passages.slice(0, 2) : props.passages);
watch(() => `${props.title || ""}\0${props.passages.map(passage => passage.reference).join("\0")}`, () => { expanded.value = false; copied.value = false; error.value = ""; });

function toggleExpanded() {
  expanded.value = !expanded.value;
  if (expanded.value) emit("expand");
}
async function jump(reference: string) {
  if (jumpBusy.value) return;
  jumpBusy.value = true;
  error.value = "";
  try {
    const query = new URLSearchParams({ reference });
    if (props.sourceId) query.set("translation", props.sourceId);
    const response = await api<{ success: boolean; result?: BibleLookupDTO; message?: string }>(`/api/bible/lookup?${query}`);
    if (!response.success || !response.result?.verses.length) throw new Error(response.message || "暂时找不到这处经文");
    await props.openPassage(response.result);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "经文打开失败，请重试";
  } finally { jumpBusy.value = false; }
}
async function handlePlay() {
  if (!props.play || playBusy.value) return;
  playBusy.value = true;
  error.value = "";
  try {
    if (await props.play() === false) throw new Error("经文暂时无法播放，请重试");
  }
  catch (cause) { error.value = cause instanceof Error ? cause.message : "经文播放失败，请重试"; }
  finally { playBusy.value = false; }
}
async function copy() {
  error.value = "";
  try {
    const text = props.copyText ? await props.copyText() : [
      ...(props.title ? [props.title] : []),
      ...props.passages.map(passage => [passage.reference, passage.text].filter(Boolean).join("\n")),
      ...(props.showTranslation && props.translation ? [props.translation] : [])
    ].join("\n\n");
    await navigator.clipboard.writeText(text);
    copied.value = true;
  } catch { error.value = "复制失败，请长按消息复制"; }
}
</script>

<template>
  <ReadingShareCard kind="bible" :paper-seed="paperSeed" class="bible-scripture-card" :text="passages.map(passage => passage.text).join('')">
    <header v-if="title" class="scripture-card-head">
      <small>经文主题</small>
      <strong>{{ title }}</strong>
    </header>
    <p v-if="note" class="scripture-card-note">{{ note }}</p>
    <p v-if="passages.length > 1" class="scripture-card-count">{{ passages.length }} 段经文</p>
    <div class="scripture-card-passages" :class="{ folded }">
      <section v-for="(passage, index) in visiblePassages" :key="`${index}-${passage.reference}`">
        <a class="reading-share-heading reading-share-reference" href="#bible" :aria-disabled="jumpBusy" :aria-busy="jumpBusy" title="在圣经中阅读这处经文" @click.stop.prevent="jump(passage.reference)">{{ passage.reference }}</a>
        <blockquote v-if="passage.text" class="reading-share-quote">{{ passage.text }}</blockquote>
      </section>
    </div>
    <button v-if="collapsible" type="button" class="scripture-card-expand" :aria-expanded="expanded" @click.stop="toggleExpanded">
      <ChevronUp v-if="expanded" :size="14" /><ChevronDown v-else :size="14" />{{ expanded ? '收起经文' : '展开全部经文' }}
    </button>
    <p v-if="showTranslation && translation" class="reading-share-meta">{{ translation }}</p>
    <footer class="scripture-card-actions" @pointerdown.stop>
      <button v-if="play" type="button" class="scripture-card-play" :disabled="playBusy" @click.stop="handlePlay"><Pause v-if="playing" :size="15" /><Play v-else :size="15" />{{ playBusy ? '正在打开…' : (playLabel || '播放经文') }}</button>
      <button type="button" :disabled="!copyText && passages.some(passage => !passage.text)" @click.stop="copy"><Check v-if="copied" :size="14" /><Copy v-else :size="14" />{{ copied ? '已复制' : '复制经文' }}</button>
    </footer>
    <slot name="playback" />
    <p v-if="error" class="reading-share-error" role="alert">{{ error }}</p>
  </ReadingShareCard>
</template>

<style scoped>
.bible-scripture-card :deep(.reading-share-card-content) { padding-bottom: 17px; }
.scripture-card-head { display: grid; gap: 3px; padding-right: 22px; margin-bottom: 14px; }
.scripture-card-head small, .scripture-card-count { color: #8b7052; font-size: 12px; }
.scripture-card-head strong { font-family: "Songti SC", "STSong", serif; font-size: 19px; line-height: 1.45; }
.scripture-card-note { white-space: pre-wrap; margin: 0 0 14px; }
.scripture-card-count { margin: 0 0 10px; }
.scripture-card-passages section + section { margin-top: 16px; padding-top: 14px; border-top: 1px solid #8b705222; }
.scripture-card-passages.folded .reading-share-quote { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.scripture-card-passages.folded section:only-child .reading-share-quote { -webkit-line-clamp: 6; }
.scripture-card-actions { display: flex; flex-wrap: wrap; gap: 6px 18px; align-items: center; margin-top: 14px; padding-top: 8px; border-top: 1px solid #8b705222; }
.scripture-card-actions button, .scripture-card-expand { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-height: 36px; border: 0; padding: 3px 0; background: transparent; color: #76502d; font: inherit; font-size: 13px; cursor: pointer; }
.scripture-card-actions .scripture-card-play { font-weight: 700; }
.scripture-card-actions button:disabled { opacity: .55; cursor: default; }
.scripture-card-expand { margin-top: 4px; }
.scripture-card-actions button:focus-visible, .scripture-card-expand:focus-visible { outline: 2px solid #527bb3; outline-offset: 3px; border-radius: 3px; }
@media (max-width: 480px) {
  .bible-scripture-card :deep(.reading-share-card-content) { padding-bottom: 16px; }
}
</style>
