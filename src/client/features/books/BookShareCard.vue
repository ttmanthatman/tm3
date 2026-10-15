<script setup lang="ts">
import { computed } from "vue";
import { ArrowRight, BookOpen, Quote } from "lucide-vue-next";
import { bookPositionLabel, bookReadingUrl, type BookReadingContext } from "./bookReading";
import ReadingShareCard from "../reading-shares/ReadingShareCard.vue";
import BookShareCover from "./BookShareCover.vue";
const props = defineProps<{ context: BookReadingContext; comment?: string }>();
const href = computed(() => bookReadingUrl(props.context, window.location.origin));
</script>
<template>
  <div class="reading-share-message book-share-message">
    <p v-if="comment" class="reading-share-comment">{{ comment }}</p>
    <ReadingShareCard kind="book" class="book-share-card" :text="context.quote || context.title">
      <div class="reading-share-book-layout">
        <BookShareCover :book-id="context.bookId" :title="context.title" />
        <div class="reading-share-book-copy">
          <span class="reading-share-label"><BookOpen :size="14" />{{ context.quote ? '书中摘录' : '共读邀请' }}</span>
          <strong class="reading-share-heading">《{{ context.title }}》</strong>
          <small v-if="!context.quote" class="reading-share-meta">邀请人已读 {{ Math.round(context.fraction * 100) }}%</small>
          <small class="reading-share-meta">位置：{{ bookPositionLabel(context.chapter, context.fraction) }}</small>
          <blockquote v-if="context.quote" class="reading-share-quote"><Quote :size="16" aria-hidden="true" /> {{ context.quote }}</blockquote>
        </div>
        <a class="reading-share-action" :href="href" @click.stop><BookOpen :size="17" />跳转到原书位置<ArrowRight :size="16" /></a>
      </div>
    </ReadingShareCard>
  </div>
</template>
