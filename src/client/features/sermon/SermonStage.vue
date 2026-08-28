<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import type { SermonQueueItem, SermonSlideBlock } from "@shared/types";
import { annotationsForVerse, splitSermonTextParagraphs, verseAnnotationSegments } from "./sermonText";

// 观众端覆盖层与讲道者演示视图共用的经文舞台：出处徽标、“某某正在分享”标识、
// 经文排版与标注片段渲染都集中在这里，结构性保证两端内容与比例一致。
// 显示设置（字体族/倍率/边距/背景）由父级 .sermon-overlay 根元素通过 CSS 变量与
// data 属性统一下发（见 sermonDisplay.ts），舞台无需感知，两端渲染保持一致。
// 统一输入的条目带 blocks（多处经文/文字混排）；旧条目无 blocks 时按 verses/content 渲染。
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

function passageVerses(block: Extract<SermonSlideBlock, { type: "passage" }>) {
  const item = props.item;
  if (!item) return [];
  return item.verses.slice(block.verseStart, block.verseStart + block.verseCount);
}

// 混排屏（多处经文或经文+文字）里每段经文带小节级出处；单段纯经文屏徽标已足够。
function showPassageRefs(item: SermonQueueItem) {
  const blocks = item.blocks ?? [];
  const passages = blocks.filter((block) => block.type === "passage").length;
  return passages > 1 || blocks.some((block) => block.type === "text");
}

// 屏内滚动同步：item.scrollLines 是全端共享的滚动行数（Shift+↑/↓ 一行步进），
// 各端按自己的实际行高换算像素；切屏/热编辑时服务端把 scrollLines 归零，
// 这里统一应用 scrollLines，观众端（含中途加入收到快照的连接）与讲道者保持一致。
const bodyEl = ref<HTMLElement | null>(null);

function passageLineHeight() {
  const passage = bodyEl.value?.querySelector<HTMLElement>(".sermon-passage");
  if (!passage) return 0;
  const lineHeight = Number.parseFloat(getComputedStyle(passage).lineHeight);
  return Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : passage.getBoundingClientRect().height;
}

watch(
  () => [props.item?.id ?? null, props.item?.scrollLines ?? 0] as const,
  async () => {
    await nextTick();
    const el = bodyEl.value;
    if (!el) return;
    const lineHeight = passageLineHeight();
    if (lineHeight > 0) el.scrollTop = (props.item?.scrollLines ?? 0) * lineHeight;
  },
  { immediate: true }
);
</script>

<template>
  <header class="sermon-overlay-head">
    <span class="sermon-overlay-badge">{{ props.item?.normalizedReference || "讲道经文" }}</span>
    <small v-if="props.presenterName">{{ props.presenterName }} 正在分享</small>
    <slot name="head-actions" />
  </header>
  <div ref="bodyEl" class="sermon-overlay-body">
    <Transition name="sermon-fade" mode="out-in">
      <div v-if="props.item?.blocks?.length" :key="props.item.id" class="sermon-passage sermon-passage-blocks">
        <template v-for="(block, blockIndex) in props.item.blocks" :key="blockIndex">
          <template v-if="block.type === 'passage'">
            <h3 v-if="showPassageRefs(props.item)" class="sermon-passage-ref">{{ block.normalizedReference }}</h3>
            <p
              v-for="(verse, localIndex) in passageVerses(block)"
              :key="`${blockIndex}-${verse.book}-${verse.chapter}-${verse.verse}`"
              class="sermon-verse"
              @click="emit('verse-click', block.verseStart + localIndex, $event)"
            >
              <sup class="sermon-verse-no">{{ verse.verse }}</sup>
              <span class="sermon-verse-text" :data-verse-index="block.verseStart + localIndex">
                <span
                  v-for="(segment, segmentIndex) in verseSegments(props.item, block.verseStart + localIndex, verse.text)"
                  :key="segmentIndex"
                  class="sermon-segment"
                  :class="{ 'sermon-highlight': segment.kinds.includes('highlight'), 'sermon-underline': segment.kinds.includes('underline') }"
                >{{ segment.text }}</span>
              </span>
            </p>
          </template>
          <p v-else class="sermon-text-paragraph">{{ block.content }}</p>
        </template>
      </div>
      <div v-else-if="props.item" :key="props.item.id" class="sermon-passage">
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
