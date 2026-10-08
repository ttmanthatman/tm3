<script setup lang="ts">
import { onBeforeUnmount, watch } from "vue";
import { useChatStore } from "../../../store";
import NoteViewer from "./NoteViewer.vue";
import { viewedBibleNoteId } from "./noteViewerState";
const emit = defineEmits<{ chat: [] }>();
const store = useChatStore();
watch(() => store.account?.id, () => { viewedBibleNoteId.value = ""; });
onBeforeUnmount(() => { viewedBibleNoteId.value = ""; });
</script>
<template><NoteViewer v-if="viewedBibleNoteId && store.account" :key="viewedBibleNoteId" :id="viewedBibleNoteId" @close="viewedBibleNoteId = ''" @chat="emit('chat')" /></template>
