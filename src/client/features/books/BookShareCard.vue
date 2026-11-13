<script setup lang="ts">
import { computed } from "vue";
import { BookOpen, Quote } from "lucide-vue-next";
import { bookPositionLabel, bookReadingUrl, type BookReadingContext } from "./bookReading";
import ReadingShareCard from "../reading-shares/ReadingShareCard.vue";
import BookShareCover from "./BookShareCover.vue";
const props = defineProps<{ context: BookReadingContext; comment?: string; paperSeed?: string | number }>();
const href = computed(() => bookReadingUrl(props.context, window.location.origin));
</script>
<template>
  <div class="reading-share-message book-share-message">
    <p v-if="comment" class="reading-share-comment">{{ comment }}</p>
    <ReadingShareCard kind="book" hide-plant :paper-seed="paperSeed" class="book-share-card" :text="context.quote || context.title">
      <div class="book-share-flow">
        <a class="book-share-cover-link" :href="href" :aria-label="`打开《${context.title}》原书位置`" @click.stop><BookShareCover :book-id="context.bookId" :title="context.title" /></a>
        <span class="reading-share-label"><BookOpen :size="14" />{{ context.quote ? '书中摘录' : '共读邀请' }}</span>
        <strong class="reading-share-heading">《{{ context.title }}》</strong>
        <small v-if="!context.quote" class="reading-share-meta">邀请人已读 {{ Math.round(context.fraction * 100) }}%</small>
        <small class="reading-share-meta">位置：{{ bookPositionLabel(context.chapter, context.fraction) }}</small>
        <blockquote v-if="context.quote" class="reading-share-quote"><Quote :size="16" aria-hidden="true" /> {{ context.quote }} <a class="book-share-inline-link" :href="href" aria-label="跳转到原书位置" title="跳转到原书位置" @click.stop><BookOpen aria-hidden="true" /></a></blockquote>
        <a v-else class="book-share-inline-link" :href="href" aria-label="跳转到原书位置" title="跳转到原书位置" @click.stop><BookOpen aria-hidden="true" /></a>
      </div>
    </ReadingShareCard>
  </div>
</template>

<style scoped>
.book-share-card :deep(.reading-share-card-content) { padding: 16px 18px 18px; }
.book-share-flow { display: flow-root; }
.book-share-cover-link { float: left; width: 96px; margin: 0 16px 8px 0; }
.book-share-flow .reading-share-quote { margin: 8px 0 0; }
.book-share-inline-link { display: inline-flex; vertical-align: -.15em; margin-left: .2em; color: #9a4c28; text-decoration: none; }
.book-share-inline-link svg { width: 1em; height: 1em; }
.book-share-cover-link:focus-visible, .book-share-inline-link:focus-visible { outline: 2px solid #527bb3; outline-offset: 3px; }
@media (max-width: 480px) {
  .book-share-cover-link { width: 76px; margin-right: 12px; }
  .book-share-card :deep(.reading-share-card-content) { padding: 14px 16px 16px; }
}
</style>
