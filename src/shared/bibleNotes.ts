import type { CopyworkSource } from "./bibleCopywork.js";

export const BIBLE_NOTE_TEXT_MAX = 10000;
export type BibleNoteSelection = { translation: string; bookCode: string; chapter: number; verse: number };
export type BibleNoteDTO = {
  id: string;
  accountId: number;
  author: string;
  source: CopyworkSource;
  text: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};
export type BibleNoteMessagePayload = { kind: "bible_note"; noteId: string; reference: string };
export function bibleNotePayload(value: unknown): BibleNoteMessagePayload | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  return row.kind === "bible_note" && typeof row.noteId === "string" && typeof row.reference === "string"
    ? { kind: "bible_note", noteId: row.noteId, reference: row.reference }
    : null;
}
