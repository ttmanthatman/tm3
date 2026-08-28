<script setup lang="ts">
import type { SermonQueueItem } from "@shared/types";
import { annotationsForVerse, splitSermonTextParagraphs, verseAnnotationSegments } from "./sermonText";

// 观众端覆盖层与讲道者演示视图共用的经文舞台：出处徽标、“某某正在分享”标识、
// 经文排版与标注片段渲染都集中在这里，结构性保证两端内容与比例一致。
// 显示设置（字体族/倍率/边距/背景）由父级 .sermon-overlay 根元素通过 CSS 变量与
// data 属性统一下发（见 sermonDisplay.ts），舞台无需感知，两端渲染保持一致。
const props = withDefaults(
  defineProps<{
    item: SermonQueueItem | null;
    presenterName?: string;
    emptyText?: string;
  }>(),
  { presenterName: "", emptyText: "讲道者正在准备经文…" }
);

const emit = defineEmits<{ "verse-click": [verseIndex: number, event: MouseEvent] }>();

function verseSegments(item: SermonQueueItem, verseIndex: number, text: string) {
  return verseAnnotationSegments(text, annotationsForVerse(item.annotations, verseIndex));
}
</script>

<template>
  <header class="sermon-overlay-head">
    <span class="sermon-overlay-badge">{{ props.item?.normalizedReference || "讲道经文" }}</span>
    <small v-if="props.presenterName">{{ props.presenterName }} 正在分享</small>
    <slot name="head-actions" />
  </header>
  <div class="sermon-overlay-body">
    <Transition name="sermon-fade" mode="out-in">
      <div v-if="props.item" :key="props.item.id" class="sermon-passage">
        <template v-if="props.item.kind === 'text'">
          <h2 v-if="props.item.title" class="sermon-text-title">{{ props.item.title }}</h2>
          <p
            v-for="(paragraph, paragraphIndex) in splitSermonTextParagraphs(props.item.content || '')"
            :key="paragraphIndex"
            class="sermon-text-paragraph"
          >{{ paragraph }}</p>
        </template>
        <template v-else>
          <p
            v-for="(verse, verseIndex) in props.item.verses"
            :key="`${verse.book}-${verse.chapter}-${verse.verse}`"
            class="sermon-verse"
            @click="emit('verse-click', verseIndex, $event)"
          >
            <sup class="sermon-verse-no">{{ verse.verse }}</sup>
            <span class="sermon-verse-text" :data-verse-index="verseIndex">
              <span
                v-for="(segment, segmentIndex) in verseSegments(props.item, verseIndex, verse.text)"
                :key="segmentIndex"
                class="sermon-segment"
                :class="{ 'sermon-highlight': segment.kinds.includes('highlight'), 'sermon-underline': segment.kinds.includes('underline') }"
              >{{ segment.text }}</span>
            </span>
          </p>
        </template>
      </div>
      <div v-else key="empty" class="sermon-passage sermon-passage-empty">{{ props.emptyText }}</div>
    </Transition>
  </div>
</template>
