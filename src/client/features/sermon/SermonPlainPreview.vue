<script setup lang="ts">
import type { SermonQueueItem, SermonSlideBlock } from "@shared/types";
import { splitSermonTextParagraphs } from "./sermonText";

const props = defineProps<{ item: SermonQueueItem }>();

function passageVerses(block: Extract<SermonSlideBlock, { type: "passage" }>) {
  return props.item.verses.slice(block.verseStart, block.verseStart + block.verseCount);
}
</script>

<template>
  <article class="sermon-plain-preview">
    <h4 v-if="item.kind !== 'text'">{{ item.normalizedReference }}</h4>
    <template v-if="item.blocks?.length">
      <template v-for="(block, blockIndex) in item.blocks" :key="blockIndex">
        <section v-if="block.type === 'passage'" class="sermon-plain-passage">
          <strong v-if="item.blocks.filter((entry) => entry.type === 'passage').length > 1">{{ block.normalizedReference }}</strong>
          <p>
            <span v-for="verse in passageVerses(block)" :key="`${verse.book}-${verse.chapter}-${verse.verse}`">
              <sup>{{ verse.verse }}</sup>{{ verse.text }}
            </span>
          </p>
        </section>
        <p v-else class="sermon-plain-text">{{ block.content }}</p>
      </template>
    </template>
    <template v-else-if="item.kind === 'text'">
      <h4 v-if="item.title">{{ item.title }}</h4>
      <p v-for="(paragraph, index) in splitSermonTextParagraphs(item.content || '')" :key="index" class="sermon-plain-text">{{ paragraph }}</p>
    </template>
    <p v-else class="sermon-plain-passage">
      <span v-for="verse in item.verses" :key="`${verse.book}-${verse.chapter}-${verse.verse}`">
        <sup>{{ verse.verse }}</sup>{{ verse.text }}
      </span>
    </p>
  </article>
</template>

<style scoped>
.sermon-plain-preview {
  display: grid;
  gap: 8px;
  padding: 16px 18px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel, #fff);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 15px;
  line-height: 1.65;
}

.sermon-plain-preview h4,
.sermon-plain-preview p {
  margin: 0;
}

.sermon-plain-passage {
  display: grid;
  gap: 4px;
}

.sermon-plain-passage p span,
.sermon-plain-preview > p > span {
  margin-right: 0.3em;
}

.sermon-plain-preview sup {
  margin-right: 0.18em;
  color: var(--muted);
  font-size: 0.72em;
}

.sermon-plain-text {
  white-space: pre-line;
}
</style>
