<script setup lang="ts">
import "./bookNotes.css";
import { computed, ref } from "vue";
import { ArrowRight, BookOpen, NotebookPen } from "lucide-vue-next";
import type { BookNoteDTO } from "@shared/bookNotes";
import AppModal from "../../components/ui/AppModal.vue";
import ReadingShareCard from "../reading-shares/ReadingShareCard.vue";
import BookShareCover from "./BookShareCover.vue";
import BookNoteContent from "./BookNoteContent.vue";
import { bookPositionLabel, bookReadingUrl } from "./bookReading";
const props = withDefaults(defineProps<{ note: BookNoteDTO; active?: boolean; comment?: string }>(), { active: true });
const viewerOpen = ref(false);
const href = computed(() => bookReadingUrl(props.note, window.location.origin));
</script>
<template>
  <div class="reading-share-message">
    <p v-if="comment" class="reading-share-comment">{{ comment }}</p>
    <ReadingShareCard kind="book" class="book-note-share-card" :text="note.text + note.quote" @click="viewerOpen = true">
      <div class="reading-share-book-layout">
        <BookShareCover :book-id="note.bookId" :title="note.bookTitle" />
        <button class="reading-share-note-open" type="button" :aria-label="`查看阅读笔记：${note.bookTitle}`" @click.stop="viewerOpen = true">
          <span class="reading-share-label"><NotebookPen :size="14" />读书笔记</span>
          <strong class="reading-share-heading">《{{ note.bookTitle }}》</strong>
          <small class="reading-share-meta">位置：{{ bookPositionLabel(note.chapter, note.fraction) }}</small>
          <span v-if="note.quote" class="reading-share-quote reading-share-note-preview">“{{ note.quote }}”</span>
          <span class="reading-share-note reading-share-note-preview">{{ note.text || '手写笔记 · 点击查看' }}</span>
        </button>
        <a class="reading-share-action" :href="href" @click.stop><BookOpen :size="17" />跳转到原书位置<ArrowRight :size="16" /></a>
      </div>
    </ReadingShareCard>
  </div>
  <Teleport to="body">
  <AppModal :open="viewerOpen" title="阅读笔记" content-class="book-action-dialog book-shared-note-paper" @close="viewerOpen = false">
    <p>《{{ note.bookTitle }}》 · {{ note.chapter }}</p>
    <blockquote>{{ note.quote }}</blockquote>
    <BookNoteContent :note="note" :active="active && viewerOpen" />
    <a :href="href" @click.stop="viewerOpen = false"><BookOpen :size="16" />回到原文</a>
  </AppModal>
  </Teleport>
</template>
<style scoped>
.book-shared-note-paper blockquote { margin: 16px 0; padding-left: 12px; border-left: 3px solid #b49a73; white-space: pre-wrap; overflow-wrap: anywhere; }
.book-shared-note-paper a { display: inline-flex; align-items: center; gap: 6px; margin-top: 16px; color: #604b32; min-height: 44px; }
</style>
