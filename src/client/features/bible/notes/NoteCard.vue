<script setup lang="ts">
import { ArrowRight, BookOpen, NotebookPen } from "lucide-vue-next";
import ReadingShareCard from "../../reading-shares/ReadingShareCard.vue";
import { openCopyworkSource } from "../copywork/copyworkViewerState";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { BibleNoteDTO } from "@shared/bibleNotes";
import { noteApi } from "./noteApi";
import { openBibleNote } from "./noteViewerState";
const props = defineProps<{ id: string; reference: string }>();
const note = ref<BibleNoteDTO | null>(null);
const error = ref("");
const jumpError = ref("");
const jumpBusy = ref(false);
let sequence = 0;
async function load() {
  const request = ++sequence;
  error.value = "";
  try { const data = await noteApi.get(props.id); if (request === sequence) note.value = data.note; }
  catch (cause) { if (request === sequence) { note.value = null; error.value = cause instanceof Error ? cause.message : "笔记暂不可查看"; } }
}
watch(() => props.id, load);
onMounted(() => { void load(); window.addEventListener("bible-notes-changed", load); });
onBeforeUnmount(() => { sequence++; window.removeEventListener("bible-notes-changed", load); });
async function jump() {
  if (!note.value || jumpBusy.value) return;
  jumpBusy.value = true; jumpError.value = "";
  try { await openCopyworkSource(note.value.source); }
  catch (cause) { jumpError.value = cause instanceof Error ? cause.message : "经文打开失败，请重试"; }
  finally { jumpBusy.value = false; }
}
</script>
<template>
  <ReadingShareCard kind="bible" class="bible-note-card" :text="note?.text" :data-note-id="id">
    <button type="button" class="reading-share-note-open" :aria-label="`查看笔记：${reference}`" @click.stop="openBibleNote(id)">
      <span class="reading-share-label"><NotebookPen :size="14" />圣经笔记</span>
      <strong class="reading-share-heading">{{ reference }}</strong>
      <span class="reading-share-note reading-share-note-preview">{{ note?.text || error || '正在翻开笔记…' }}</span>
      <small class="reading-share-meta">{{ note?.author || '经文笔记' }} · 点击查看笔记</small>
    </button>
    <button type="button" class="reading-share-action" :disabled="!note || jumpBusy" @click.stop="jump"><BookOpen :size="17" />{{ jumpBusy ? '正在打开…' : '跳转到经文' }}<ArrowRight :size="16" /></button>
    <p v-if="jumpError" class="reading-share-error" role="alert">{{ jumpError }}</p>
  </ReadingShareCard>
</template>
