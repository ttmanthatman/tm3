<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { BookOpen } from "lucide-vue-next";
import { getToken } from "../../api";
import { bookPositionLabel, bookReadingUrl, type BookReadingContext } from "./bookReading";

const props = defineProps<{ context: BookReadingContext }>();
const coverFailed = ref(false);
watch(() => props.context.bookId, () => { coverFailed.value = false; });
const cover = computed(() => `/api/books/${props.context.bookId}/cover?token=${encodeURIComponent(getToken())}`);
const href = computed(() => bookReadingUrl(props.context, window.location.origin));
</script>

<template>
  <div class="book-share-message">
    <p>{{ context.quote ? '摘录自' : '邀请你一起读' }}《{{ context.title }}》</p>
    <blockquote v-if="context.quote">{{ context.quote }}</blockquote>
    <a class="book-share-card" :href="href" @click.stop>
      <img v-if="!coverFailed" class="book-share-cover" :src="cover" :alt="`《${context.title}》封面`" loading="lazy" @error="coverFailed = true" />
      <span v-else class="book-share-cover fallback"><BookOpen :size="30" />{{ context.title }}</span>
      <span class="book-share-copy"><strong>{{ context.title }}</strong><span>{{ context.quote ? '摘录位置' : '邀请人已读' }} {{ Math.round(context.fraction * 100) }}%</span><span class="book-share-position">打开书中的位置<br>{{ bookPositionLabel(context.chapter, context.fraction) }}</span></span>
    </a>
  </div>
</template>

<style scoped>
.book-share-message { max-width: 340px; min-width: min(220px, 100%); }
.book-share-message p { margin: 0 0 8px; }
.book-share-message blockquote { margin: 0 0 10px; white-space: pre-wrap; overflow-wrap: anywhere; }
.book-share-card { display: flex; gap: 12px; padding: 10px; background: #fffaf0; color: #493b2c; border-radius: 8px; text-decoration: none; }
.book-share-cover { width: 80px; height: 120px; flex: 0 0 80px; object-fit: cover; border-radius: 3px; }
.book-share-cover.fallback { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 5px; background: #dfd2b9; text-align: center; font-size: 12px; overflow-wrap: anywhere; }
.book-share-copy { display: flex; flex-direction: column; gap: 8px; min-width: 0; font-size: 12px; overflow-wrap: anywhere; }
.book-share-copy strong { font-size: 15px; }
.book-share-position { margin-top: auto; color: #6b543e; line-height: 1.6; }
</style>
