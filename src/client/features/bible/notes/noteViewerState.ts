import { ref } from "vue";
export const viewedBibleNoteId = ref("");
export function openBibleNote(id: string) { viewedBibleNoteId.value = id; }
export function bibleNotesChanged() { window.dispatchEvent(new Event("bible-notes-changed")); }
