<script setup lang="ts">
import { ref } from "vue";
import { BookOpen, ListChecks } from "lucide-vue-next";
import type { BibleLookupDTO } from "@shared/types";
import type { BibleTopicMessagePayload } from "@shared/bibleTopics";
import { api } from "../../api";
import ReadingShareCard from "../reading-shares/ReadingShareCard.vue";

// 出处沿用卡片原本的棕色文字行（无图标、无框、无底色），交互学普通消息的
// inline-bible 引用：点出处展开正文，展开区末尾的书本按钮跳转圣经上下文；
// 正文直接取消息自带的 payload，无需查库。
const props = defineProps<{
  topic: BibleTopicMessagePayload;
  openPassage: (lookup: BibleLookupDTO) => Promise<void>;
  paperSeed?: string | number;
}>();
const expanded = ref(new Set<number>());
const jumpBusy = ref("");
const error = ref("");

function toggle(index: number) {
  const next = new Set(expanded.value);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  expanded.value = next;
}

async function jump(reference: string) {
  if (jumpBusy.value) return;
  jumpBusy.value = reference;
  error.value = "";
  try {
    const response = await api<{ success: boolean; result?: BibleLookupDTO; message?: string }>(
      `/api/bible/lookup?reference=${encodeURIComponent(reference)}`
    );
    if (!response.success || !response.result?.verses.length)
      throw new Error(response.message || "暂时找不到这处经文");
    await props.openPassage(response.result);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "经文打开失败，请重试";
  } finally {
    jumpBusy.value = "";
  }
}
</script>

<template>
  <ReadingShareCard
    kind="bible"
    :paper-seed="paperSeed"
    class="bible-topic-share-card"
    :text="topic.name"
  >
    <header class="bible-topic-share-head">
      <span class="bible-topic-share-kicker"><ListChecks :size="15" />经文主题</span>
      <strong>{{ topic.name }}</strong>
      <small>{{ topic.passages.length }} 段经文 · {{ topic.translation }}</small>
    </header>
    <ul class="bible-topic-share-list">
      <li v-for="(passage, index) in topic.passages" :key="`${index}-${passage.reference}`">
        <button
          class="bible-topic-share-reference"
          type="button"
          :aria-expanded="expanded.has(index)"
          @click.stop="toggle(index)"
        >
          {{ passage.reference }}
        </button>
        <span v-if="expanded.has(index)" class="inline-bible-popover">
          <span class="inline-bible-passage">
            <span class="inline-bible-body">{{ passage.text }}</span>
            <button
              class="bible-topic-share-reader-link"
              type="button"
              title="在圣经中阅读"
              aria-label="在圣经中阅读并高亮这处经文"
              :disabled="jumpBusy !== ''"
              @click.stop="jump(passage.reference)"
            >
              <BookOpen :size="15" />
            </button>
          </span>
        </span>
      </li>
    </ul>
    <p v-if="error" class="reading-share-error" role="alert">{{ error }}</p>
  </ReadingShareCard>
</template>

<style scoped>
.bible-topic-share-card {
  max-width: 100%;
}
.bible-topic-share-head {
  display: grid;
  gap: 4px;
}
.bible-topic-share-kicker {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #95704a;
  font-size: 12px;
  font-weight: 700;
}
.bible-topic-share-head strong {
  font-family: "Songti SC", "STSong", serif;
  font-size: 19px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.bible-topic-share-head small {
  color: #92775b;
}
.bible-topic-share-list {
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 2px;
  align-content: start;
  max-height: 420px;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: #cbb797 transparent;
}
.bible-topic-share-list::-webkit-scrollbar {
  width: 4px;
}
.bible-topic-share-list::-webkit-scrollbar-thumb {
  border-radius: 2px;
  background: #cbb797;
}
.bible-topic-share-list::-webkit-scrollbar-track {
  background: transparent;
}
.bible-topic-share-reference {
  width: 100%;
  min-height: 38px;
  border: 0;
  padding: 0 4px;
  display: flex;
  align-items: center;
  color: #76502d;
  background: transparent;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  text-align: left;
}
.bible-topic-share-reference:hover {
  color: #5c3f1f;
}
.bible-topic-share-reference:focus-visible {
  outline: 2px solid #527bb3;
  outline-offset: 3px;
}
/* 展开正文沿用 inline-bible 的排版，但去掉框、白底与阴影，
   正文用卡片同款褐色并强制换行；width 用 auto，避免 100% 加边距撑出横向滚动 */
.bible-topic-share-list .inline-bible-popover {
  width: auto;
  max-height: none;
  overflow: visible;
  margin: 0 4px 10px;
  border: 0;
  border-radius: 0;
  padding: 0;
  background: transparent;
  box-shadow: none;
  color: #76502d;
  overflow-wrap: anywhere;
}
.bible-topic-share-reader-link {
  margin-left: 6px;
  border: 0;
  padding: 2px;
  display: inline-flex;
  align-items: center;
  vertical-align: baseline;
  color: #76502d;
  background: transparent;
  cursor: pointer;
}
.bible-topic-share-reader-link:hover {
  color: #5c3f1f;
}
.bible-topic-share-reader-link:focus-visible {
  outline: 2px solid #527bb3;
  outline-offset: 3px;
}
.bible-topic-share-reader-link:disabled {
  opacity: 0.45;
  cursor: wait;
}
</style>
