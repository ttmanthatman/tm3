<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { BibleNoteDTO, BibleNoteSelection } from "@shared/bibleNotes";
import { noteApi } from "./noteApi";
import { openBibleNote } from "./noteViewerState";
import NotesTransfer from "../../notes/NotesTransfer.vue";
const props = defineProps<{ accountId: number; filter?: BibleNoteSelection }>();
const scope = ref<"mine" | "public">(props.filter ? "public" : "mine");
const notes = ref<BibleNoteDTO[]>([]);
const notesBusy = ref(false);
const error = ref("");
const nextOffset = ref<number | null>(null);
let sequence = 0;
async function load(more = false) {
  if (more && (notesBusy.value || nextOffset.value === null)) return;
  const request = ++sequence;
  notesBusy.value = true;
  error.value = "";
  if (!more) notes.value = [];
  try {
    const data = await noteApi.list(scope.value, props.filter, more ? nextOffset.value! : 0);
    if (request !== sequence) return;
    notes.value = more ? [...notes.value, ...data.notes] : data.notes;
    nextOffset.value = data.nextOffset;
  } catch (cause) {
    if (request === sequence) error.value = cause instanceof Error ? cause.message : "笔记加载失败";
  } finally { if (request === sequence) notesBusy.value = false; }
}
function refresh() { void load(); }
watch(() => [scope.value, props.accountId, props.filter], refresh);
onMounted(() => { refresh(); window.addEventListener("bible-notes-changed", refresh); });
onBeforeUnmount(() => { sequence++; window.removeEventListener("bible-notes-changed", refresh); });
</script>
<template>
  <section class="note-library" aria-label="经文笔记列表">
    <div class="library-toolbar">
      <nav aria-label="笔记分类"><button :aria-pressed="scope === 'mine'" @click="scope = 'mine'">我的笔记</button><button :aria-pressed="scope === 'public'" @click="scope = 'public'">公开笔记</button></nav>
      <NotesTransfer v-if="scope === 'mine'" domain="bible" :account-id="accountId" />
    </div>
    <p v-if="error" role="alert">{{ error }} <button @click="load()">重试</button></p>
    <div class="notes"><button v-for="note in notes" :key="note.id" class="note-preview" :aria-label="`查看笔记：${note.source.reference}`" @click="openBibleNote(note.id)">
      <strong>{{ note.source.reference }}</strong><p>{{ note.text }}</p><small>{{ note.author }} · {{ new Date(note.updatedAt).toLocaleDateString('zh-CN') }}<span v-if="scope === 'mine'"> · {{ note.publishedAt ? '已公开' : '仅自己可见' }}</span></small>
    </button></div>
    <p v-if="notesBusy" role="status">正在翻开笔记…</p>
    <p v-else-if="!notes.length && !error" class="empty">{{ scope === 'mine' ? '在阅读时选中一节经文，点「笔记」，记下你的领受。' : '这里还没有公开笔记。' }}</p>
    <button v-if="nextOffset !== null" :disabled="notesBusy" @click="load(true)">更多笔记</button>
  </section>
</template>
<style scoped>
.note-library { min-height: 0; overflow: auto; max-width: 1080px; margin: auto; padding: 20px; color: #69553c; }
.library-toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; }
nav { display: flex; flex-wrap: wrap; gap: 10px; }
button { font: inherit; color: inherit; cursor: pointer; }
nav button, .note-library > button, [role=alert] button { min-height: 42px; padding: 9px 16px; border: 1px solid #d9cdb8; background: #fffaf1; border-radius: 6px; }
nav button[aria-pressed=true] { background: #647d61; border-color: #647d61; color: white; }
.notes { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(230px, 100%), 1fr)); gap: 20px; }
.note-preview { display: grid; align-content: start; gap: 12px; min-width: 0; border: 0; border-radius: 2px; background: #fff5cf; box-shadow: 0 3px 9px #62533e12; padding: 20px; text-align: left; overflow-wrap: anywhere; }
.note-preview p { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; overflow: hidden; margin: 0; line-height: 1.9; white-space: pre-wrap; }
.note-preview small { font-size: 11px; color: #8c7c5d; }
.empty { padding: 30px 0; line-height: 1.9; text-align: center; }
[role=alert] { color: #a14d38; }
</style>
