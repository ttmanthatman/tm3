import type { BibleNote } from "@prisma/client";
import type { BibleNoteDTO, BibleNoteSelection } from "../../shared/bibleNotes.js";
import type { CopyworkSource } from "../../shared/bibleCopywork.js";
import { copyworkSource } from "./bibleCopyworks.js";

export function bibleNoteSource(selection: BibleNoteSelection): CopyworkSource {
  return copyworkSource({ ...selection, verseStart: selection.verse, verseEnd: selection.verse });
}

export function bibleNoteDTO(note: BibleNote & { account: { displayName: string } }): BibleNoteDTO {
  return {
    id: note.id,
    accountId: note.accountId,
    author: note.account.displayName,
    source: note.source as unknown as CopyworkSource,
    text: note.text,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    publishedAt: note.publishedAt?.toISOString() || null
  };
}
