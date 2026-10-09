import { ref } from "vue";
import type { BibleNoteSelection } from "@shared/bibleNotes";
export const viewedBibleNoteId = ref("");
export const viewedBibleNoteFilter = ref<BibleNoteSelection | null>(null);
export function closeBibleNote() { viewedBibleNoteId.value = ""; viewedBibleNoteFilter.value = null; }
export function openBibleNote(id: string) { closeBibleNote(); viewedBibleNoteId.value = id; }
export function openVerseNotes(filter: BibleNoteSelection) { closeBibleNote(); viewedBibleNoteFilter.value = filter; }
export function bibleNotesChanged() { window.dispatchEvent(new Event("bible-notes-changed")); }
