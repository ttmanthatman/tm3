<script setup lang="ts">
import { computed } from "vue";
import type { BookNoteInput } from "@shared/bookNotes";
import type { MessageDTO } from "@shared/types";
import HandwritingMessage from "../handwriting/HandwritingMessage.vue";
const props = withDefaults(defineProps<{ note: Pick<BookNoteInput, "text" | "handwriting">; active?: boolean }>(), { active: true });
const ink = computed<MessageDTO>(() => ({
  id: 0, channelId: 0, type: "handwriting", content: "手写笔记", payload: props.note.handwriting,
  sender: { id: 0, kind: "human", username: "", displayName: "", avatarPath: null }, createdAt: "2026-01-01T00:00:00.000Z"
}));
</script>
<template>
  <p v-if="note.text" class="book-note-text">{{ note.text }}</p>
  <HandwritingMessage v-if="note.handwriting" :message="ink" variant="favorite" interactive :surface-active="active" />
</template>
<style scoped>
.book-note-text { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.8; }
</style>
