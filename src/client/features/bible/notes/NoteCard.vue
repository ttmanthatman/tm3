<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { BibleNoteDTO } from "@shared/bibleNotes";
import { noteApi } from "./noteApi";
import { openBibleNote } from "./noteViewerState";
const props = defineProps<{ id: string; reference: string }>();
const note = ref<BibleNoteDTO | null>(null);
const error = ref("");
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
</script>
<template><button class="bible-note-card" :data-note-id="id" :aria-label="`查看笔记：${reference}`" @click.stop="openBibleNote(id)"><strong>{{ reference }}</strong><p>{{ note?.text || error || '正在翻开笔记…' }}</p><small>{{ note?.author || '经文笔记' }}</small></button></template>
<style scoped>
.bible-note-card { display: grid; gap: 10px; max-width: 100%; width: min(300px, 100%); padding: 18px; background: #fff6d5; border: 0; border-radius: 2px; color: #65553a; text-align: left; font: inherit; cursor: pointer; overflow-wrap: anywhere; }
strong { font-size: 13px; font-weight: 500; }
p { margin: 0; white-space: pre-wrap; line-height: 1.9; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; font-size: var(--message-content-font-size, 16px); }
small { color: #978360; font-size: 11px; }
</style>
