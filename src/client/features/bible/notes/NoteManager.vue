<script setup lang="ts">
import type { BibleNoteDTO, BibleNoteSelection } from "@shared/bibleNotes";
import { BIBLE_NOTE_TEXT_MAX } from "@shared/bibleNotes";
import type { BibleVerseLineDTO } from "@shared/types";
import { watch } from "vue";
import AppModal from "../../../components/ui/AppModal.vue";
import { useBibleNoteEditor } from "./useBibleNoteEditor";
import { bibleNotesChanged, closeBibleNote, openBibleNote, openVerseNotes, viewedBibleNoteFilter } from "./noteViewerState";

const props = withDefaults(defineProps<{ accountId: number; active?: boolean }>(), { active: true });
const emit = defineEmits<{ changed: [] }>();
const editor = useBibleNoteEditor();
const { editorOpen, publicationOpen, editorBusy, text, error, source, publish, skipPrompt } = editor;
function start(selection: { translation: string; bookCode: string; verses: BibleVerseLineDTO[] }) {
  const verse = selection.verses[0];
  if (selection.verses.length !== 1 || !verse || verse.endVerse !== verse.verse) return;
  void editor.start({ translation: selection.translation, bookCode: selection.bookCode, chapter: verse.chapter, verse: verse.verse });
}
function edit(note: BibleNoteDTO) {
  void editor.start({ translation: note.source.translation, bookCode: note.source.bookCode, chapter: note.source.chapter, verse: note.source.verseStart }, note);
}
function saved(note: BibleNoteDTO | null) {
  if (!note) return;
  emit("changed");
  bibleNotesChanged();
  openBibleNote(note.id);
}
async function finish() { saved(await editor.finish()); }
async function save() { saved(await editor.save()); }
function browse(selection: BibleNoteSelection) { openVerseNotes(selection); }
watch(() => props.active, (active) => {
  if (active) return;
  if (viewedBibleNoteFilter.value) closeBibleNote();
  editorOpen.value = false;
  publicationOpen.value = false;
});
defineExpose({ start, edit, browse });
</script>
<template>
  <Teleport to="body">
    <AppModal :open="editorOpen" title="经文笔记" size="medium" :busy="editorBusy" content-class="bible-note-editor" @close="finish">
      <div class="note-editor-body">
        <blockquote v-if="source"><strong>{{ source.reference }}</strong><p>{{ source.text }}</p><small>{{ source.translationName }}</small></blockquote>
        <p v-if="editorBusy && !source" role="status">正在准备经文…</p>
        <label class="note-text-label">写下此刻的领受
          <textarea v-model="text" aria-label="笔记内容" :maxlength="BIBLE_NOTE_TEXT_MAX" :disabled="editorBusy || !source" placeholder="一句感动，也值得记下。" />
        </label>
        <p v-if="error" role="alert">{{ error }} <button v-if="!source" :disabled="editorBusy" @click="editor.retry">重试</button></p>
      </div>
      <footer class="note-editor-footer"><small>{{ text.length }} / {{ BIBLE_NOTE_TEXT_MAX }}</small><button type="button" :disabled="editorBusy || !source || !text.trim()" @click="finish">{{ editorBusy ? '保存中…' : '完成笔记' }}</button></footer>
    </AppModal>
    <AppModal :open="publicationOpen" title="公开这篇笔记？" :busy="editorBusy" content-class="bible-note-publication" @close="publicationOpen = false">
      <div class="publication-body">
        <p>让这节经文下，多一份彼此的领受。</p>
        <label><input v-model="publish" type="radio" :value="true" name="note-public" />公开，分享到圣经</label>
        <label><input v-model="publish" type="radio" :value="false" name="note-public" />仅自己可见</label>
        <label class="note-remember"><input v-model="skipPrompt" type="checkbox" :disabled="!publish" />不再提示，以后都公开</label>
        <p v-if="error" role="alert">{{ error }}</p>
        <div class="publication-actions"><button type="button" :disabled="editorBusy" @click="publicationOpen = false">继续写</button><button type="button" :disabled="editorBusy" @click="save">{{ editorBusy ? '保存中…' : '保存笔记' }}</button></div>
      </div>
    </AppModal>
  </Teleport>
</template>
<style scoped>
:deep(.bible-note-editor), :deep(.bible-note-publication) { background: #fbf6e7; color: #62533e; }
:deep(.bible-note-editor) { grid-template-rows: auto minmax(0, 1fr) auto; }
.note-editor-body { padding: 20px; overflow: auto; min-height: 0; }
blockquote { margin: 0 0 20px; padding-left: 14px; border-left: 2px solid #d8c99e; line-height: 1.8; }
blockquote p { margin: 6px 0; }
small { color: #8b7d65; }
.note-text-label { display: grid; gap: 10px; font-size: 13px; }
textarea { box-sizing: border-box; width: 100%; min-height: 240px; resize: vertical; padding: 14px; border: 1px solid #dfd3b6; border-radius: 3px; background: #fffdf4; color: inherit; font: inherit; font-size: 17px; line-height: 1.9; }
.note-editor-footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 20px max(12px, var(--safe-bottom)); }
button { min-height: 42px; border: 1px solid #d8ccad; border-radius: 6px; padding: 8px 16px; background: #fffaf0; color: inherit; font: inherit; cursor: pointer; }
.note-editor-footer button, .publication-actions button:last-child { background: #647d61; border-color: #647d61; color: white; }
.publication-body { padding: 20px; max-height: 65dvh; overflow: auto; }
.publication-body > label { display: flex; gap: 10px; align-items: center; padding: 12px 0; }
.publication-body input { accent-color: #647d61; }
.publication-body .note-remember { font-size: 13px; padding-top: 20px; }
.publication-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
[role=alert] { color: #a14d38; }
@media (max-width: 480px) { .note-editor-body { padding: 16px; } textarea { min-height: 180px; } }
</style>
