<script setup lang="ts">
import { onScopeDispose, ref, watch } from "vue";
import { bookNoteHasContent, type BookNoteDTO } from "@shared/bookNotes";
import { BIBLE_FAVORITE_COLOR_PRESETS } from "@shared/bibleFavoriteColors";
import { api } from "../../api";
import { useChatStore } from "../../store";
import { bookNotesClient } from "./bookNotesClient";
import type { BookLocation } from "./bookReading";

const emit = defineEmits<{ navigate: [location: BookLocation] }>();
const store = useChatStore();
const notes = ref<BookNoteDTO[]>([]), busy = ref(false), error = ref("");
let sequence = 0;
async function load() {
  const request = ++sequence;
  notes.value = []; error.value = "";
  if (!store.account || store.account.isGuest) { busy.value = false; return; }
  busy.value = true;
  try {
    const { books } = await api<{ books: { id: number }[] }>("/api/books");
    const results: BookNoteDTO[] = [];
    for (const book of books) {
      if (request !== sequence) return;
      results.push(...(await bookNotesClient.list(book.id)).notes.filter(note => note.color));
    }
    if (request === sequence) notes.value = results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch (cause) { if (request === sequence) error.value = cause instanceof Error ? cause.message : "图书收藏读取失败"; }
  finally { if (request === sequence) busy.value = false; }
}
async function update(note: BookNoteDTO, color?: string) {
  if (busy.value) return;
  const request = sequence;
  busy.value = true; error.value = "";
  try {
    if (!color && !bookNoteHasContent(note)) await bookNotesClient.remove(note.bookId, note.id);
    else await bookNotesClient.save(note.bookId, note.id, { quote: note.quote, text: note.text, chapter: note.chapter, fraction: note.fraction, handwriting: note.handwriting, draft: note.draft, locator: note.locator, ...(color ? { color } : {}) });
    if (request !== sequence) return;
    if (color) note.color = color;
    else notes.value = notes.value.filter(item => item.id !== note.id);
  } catch (cause) { if (request === sequence) error.value = cause instanceof Error ? cause.message : "图书收藏更新失败"; }
  finally { if (request === sequence) busy.value = false; }
}
watch(() => store.account?.id, load, { immediate: true });
onScopeDispose(() => { sequence++; });
</script>

<template>
  <section class="book-favorites" aria-label="图书收藏夹">
    <h3>图书高亮收藏</h3>
    <p v-if="error" role="alert">{{ error }} <button :disabled="busy" @click="load">重试</button></p>
    <p v-if="busy" role="status">正在处理图书收藏…</p>
    <p v-else-if="!notes.length && !error">在图书正文中选择文字，点击颜色即可高亮并自动收藏。</p>
    <article v-for="note in notes" :key="note.id">
      <strong>《{{ note.bookTitle }}》</strong><small>{{ note.chapter }}</small>
      <blockquote :style="{ borderColor: note.color, backgroundColor: `${note.color}22` }">{{ note.quote }}</blockquote>
      <div class="book-favorite-colors" aria-label="收藏高亮颜色">
        <button v-for="preset in BIBLE_FAVORITE_COLOR_PRESETS" :key="preset.color" :aria-label="`改为${preset.name}高亮`" :aria-pressed="note.color === preset.color" :style="{ backgroundColor: preset.color }" :disabled="busy" @click="update(note, preset.color)"></button>
      </div>
      <footer><button @click="emit('navigate', note)">回到原文</button><button :disabled="busy" @click="update(note)">取消收藏</button></footer>
    </article>
  </section>
</template>

<style scoped>
.book-favorites { padding: 12px; color: var(--text, #604b32); }
h3 { margin: 0 0 12px; font-size: 16px; }
article { padding: 12px 0; border-bottom: 1px solid #bda98b66; }
small { display: block; margin-top: 5px; }
blockquote { margin: 12px 0; padding: 10px; border-left: 4px solid; white-space: pre-wrap; overflow-wrap: anywhere; }
footer, .book-favorite-colors { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 10px 0; }
button { cursor: pointer; }
.book-favorite-colors button { width: 28px; height: 28px; min-height: 28px; padding: 0; flex: 0 0 28px; border: 2px solid transparent; border-radius: 50%; }
.book-favorite-colors button[aria-pressed="true"] { outline: 2px solid currentColor; outline-offset: 2px; }
</style>
