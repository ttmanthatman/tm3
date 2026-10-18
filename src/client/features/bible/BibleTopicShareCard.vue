<script setup lang="ts">
import { ref } from "vue";
import { BookOpen, ChevronDown, ListChecks } from "lucide-vue-next";
import type { BibleLookupDTO } from "@shared/types";
import type { BibleTopicMessagePayload } from "@shared/bibleTopics";
import { api } from "../../api";
import ReadingShareCard from "../reading-shares/ReadingShareCard.vue";

const props = defineProps<{ topic: BibleTopicMessagePayload; openPassage: (lookup: BibleLookupDTO) => Promise<void>; paperSeed?: string | number }>();
const expanded = ref(new Set<string>());
const jumpBusy = ref("");
const error = ref("");

function passageKey(reference: string, index: number) {
  return `${index}:${reference}`;
}

function toggle(reference: string, index: number) {
  const key = passageKey(reference, index);
  const next = new Set(expanded.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expanded.value = next;
}

const allExpanded = () => props.topic.passages.length > 0 && expanded.value.size >= props.topic.passages.length;

function toggleAll() {
  expanded.value = allExpanded()
    ? new Set()
    : new Set(props.topic.passages.map((passage, index) => passageKey(passage.reference, index)));
}

async function jump(reference: string) {
  if (jumpBusy.value) return;
  jumpBusy.value = reference;
  error.value = "";
  try {
    const response = await api<{ success: boolean; result?: BibleLookupDTO; message?: string }>(`/api/bible/lookup?reference=${encodeURIComponent(reference)}`);
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
  <ReadingShareCard kind="bible" :paper-seed="paperSeed" class="bible-topic-share-card" :text="topic.name">
    <header class="bible-topic-share-head">
      <span class="bible-topic-share-kicker"><ListChecks :size="15" />经文主题</span>
      <strong>{{ topic.name }}</strong>
      <small>{{ topic.passages.length }} 段经文 · {{ topic.translation }}</small>
    </header>
    <ul class="bible-topic-share-list">
      <li v-for="(passage, index) in topic.passages" :key="`${index}-${passage.reference}`">
        <button class="bible-topic-share-reference" type="button" :aria-expanded="expanded.has(passageKey(passage.reference, index))" @click="toggle(passage.reference, index)">
          <ChevronDown class="bible-topic-share-chevron" :class="{ open: expanded.has(passageKey(passage.reference, index)) }" :size="15" />
          <span>{{ passage.reference }}</span>
        </button>
        <blockquote v-if="expanded.has(passageKey(passage.reference, index))" class="bible-topic-share-verses">{{ passage.text }}</blockquote>
      </li>
    </ul>
    <footer class="bible-topic-share-foot">
      <button type="button" @click="toggleAll">{{ allExpanded() ? "全部收起" : "全部展开" }}</button>
      <button type="button" :disabled="jumpBusy !== ''" title="在圣经中阅读第一段经文" @click="jump(topic.passages[0].reference)"><BookOpen :size="14" />在圣经中阅读</button>
    </footer>
    <p v-if="error" class="reading-share-error" role="alert">{{ error }}</p>
  </ReadingShareCard>
</template>

<style scoped>
.bible-topic-share-card { max-width: 100%; }
.bible-topic-share-head { display: grid; gap: 4px; }
.bible-topic-share-kicker { display: inline-flex; align-items: center; gap: 5px; color: #95704a; font-size: 12px; font-weight: 700; }
.bible-topic-share-head strong { font-family: "Songti SC", "STSong", serif; font-size: 19px; line-height: 1.4; overflow-wrap: anywhere; }
.bible-topic-share-head small { color: #92775b; }
.bible-topic-share-list { margin: 10px 0 0; padding: 0; list-style: none; display: grid; gap: 2px; max-height: 420px; overflow-y: auto; overscroll-behavior: contain; }
.bible-topic-share-reference { width: 100%; min-height: 38px; border: 0; padding: 0 4px; display: flex; align-items: center; gap: 6px; color: #76502d; background: transparent; font: inherit; font-weight: 700; cursor: pointer; text-align: left; }
.bible-topic-share-reference span { min-width: 0; overflow-wrap: anywhere; }
.bible-topic-share-chevron { flex-shrink: 0; transition: transform .18s ease; }
.bible-topic-share-chevron.open { transform: rotate(180deg); }
.bible-topic-share-verses { margin: 0 4px 8px 25px; padding: 0; border: 0; color: #574330; font-family: "Songti SC", "STSong", serif; font-size: 15px; line-height: 1.8; white-space: pre-wrap; }
.bible-topic-share-foot { display: flex; justify-content: space-between; gap: 8px; margin-top: 10px; }
.bible-topic-share-foot button { min-height: 34px; border: 1px solid #cbb797; border-radius: 8px; padding: 0 10px; color: #6d5135; background: #faf4e8; display: inline-flex; align-items: center; gap: 5px; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
.bible-topic-share-foot button:disabled { opacity: .45; cursor: wait; }
</style>
