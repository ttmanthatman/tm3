<script setup lang="ts">
import "./bookNotes.css";
import { computed, ref } from "vue";
import { BookOpen, NotebookPen } from "lucide-vue-next";
import type { BookNoteDTO } from "@shared/bookNotes";
import AppModal from "../../components/ui/AppModal.vue";
import BookNoteContent from "./BookNoteContent.vue";
import { bookReadingUrl } from "./bookReading";
const props = withDefaults(defineProps<{ note: BookNoteDTO; active?: boolean }>(), { active: true });
const viewerOpen = ref(false);
const href = computed(() => bookReadingUrl(props.note, window.location.origin));
</script>
<template>
  <button class="book-note-share-card" type="button" @pointerdown.stop @click.stop="viewerOpen = true">
    <NotebookPen :size="24" /><span><strong>《{{ note.bookTitle }}》</strong><small>{{ note.chapter }} · 阅读笔记</small><span>{{ note.text || '手写笔记' }}</span></span>
  </button>
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
.book-note-share-card { display: flex; align-items: center; gap: 12px; width: min(320px, 100%); padding: 16px; border: 1px solid #b9a17b; border-radius: 8px; background: #dfceb0; color: #493b2c; text-align: left; cursor: pointer; font: inherit; }
.book-note-share-card > svg { flex-shrink: 0; }
.book-note-share-card > span { display: grid; gap: 7px; min-width: 0; }
.book-note-share-card strong, .book-note-share-card small { overflow-wrap: anywhere; }
.book-note-share-card span span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
blockquote { margin: 16px 0; padding-left: 12px; border-left: 3px solid #b49a73; white-space: pre-wrap; overflow-wrap: anywhere; }
a { display: inline-flex; align-items: center; gap: 6px; margin-top: 16px; color: #604b32; min-height: 44px; }
</style>
