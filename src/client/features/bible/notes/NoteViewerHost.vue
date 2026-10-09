<script setup lang="ts">
import { onBeforeUnmount, watch } from "vue";
import { useChatStore } from "../../../store";
import NoteViewer from "./NoteViewer.vue";
import { closeBibleNote, viewedBibleNoteFilter, viewedBibleNoteId } from "./noteViewerState";
const emit = defineEmits<{ chat: [] }>();
const store = useChatStore();
watch(() => store.account?.id, closeBibleNote);
onBeforeUnmount(closeBibleNote);
</script>
<template><NoteViewer v-if="(viewedBibleNoteId || viewedBibleNoteFilter) && store.account" :key="viewedBibleNoteId || JSON.stringify(viewedBibleNoteFilter)" :id="viewedBibleNoteId || undefined" :filter="viewedBibleNoteFilter || undefined" @close="closeBibleNote" @chat="emit('chat')" /></template>
