import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { BIBLE_NOTE_TEXT_MAX } from "../../shared/bibleNotes.js";
import { importBibleNoteBackup, parseBibleNoteBackup } from "./bibleNoteBackup.js";

const noteId = "8c6e6fda-f26b-4d19-9c64-b0c0bd4d1701";
const backup = {
  id: noteId,
  accountId: 1,
  translation: "cmn-cu89s",
  bookCode: "JHN",
  chapter: 11,
  verse: 35,
  source: { text: "备份时的经文。", reference: "untrusted", translation: "untrusted" },
  text: "  今天记下的感动。\n再思想这节经文。  ",
  createdAt: "2026-10-08T01:00:00.000Z",
  updatedAt: "2026-10-08T02:00:00.000Z",
  publishedAt: null,
  shares: [{ messageId: 7 }]
};

test("Bible note backup canonicalizes the single verse and preserves saved text and dates", () => {
  const [note] = parseBibleNoteBackup([backup]);
  assert.equal(note.source.reference, "约翰福音 11:35");
  assert.equal(note.source.translation, backup.translation);
  assert.equal(note.source.verseStart, 35);
  assert.equal(note.source.verseEnd, 35);
  assert.equal(note.source.text, backup.source.text);
  assert.equal(note.text, backup.text);
  assert.equal(note.createdAt.toISOString(), backup.createdAt);
  assert.equal(note.updatedAt.toISOString(), backup.updatedAt);
  assert.equal(note.publishedAt, null);
  assert.equal(
    parseBibleNoteBackup([
      { ...backup, publishedAt: backup.updatedAt }
    ])[0].publishedAt?.toISOString(),
    backup.updatedAt
  );
  assert.deepEqual(parseBibleNoteBackup([]), []);
});

test("Bible note backup rejects malformed selections, ownership, dates, and empty or oversized notes", () => {
  for (const invalid of [
    { id: "not-a-uuid" },
    { accountId: 0 },
    { accountId: 1.5 },
    { translation: "unknown" },
    { bookCode: "XXX" },
    { chapter: 999 },
    { verse: 999 },
    { text: " \n " },
    { text: "文".repeat(BIBLE_NOTE_TEXT_MAX + 1) },
    { source: { text: "" } },
    { createdAt: "invalid" },
    { updatedAt: null },
    { publishedAt: "invalid" },
    { shares: [{ messageId: 0 }] }
  ])
    assert.throws(() => parseBibleNoteBackup([{ ...backup, ...invalid }]));
  assert.equal(
    parseBibleNoteBackup([{ ...backup, text: "文".repeat(BIBLE_NOTE_TEXT_MAX) }])[0].text.length,
    BIBLE_NOTE_TEXT_MAX
  );
  assert.throws(() => parseBibleNoteBackup({}));
});

function transaction(message: unknown) {
  const writes: { notes: unknown[]; deletions: unknown[]; shares: unknown[] } = {
    notes: [],
    deletions: [],
    shares: []
  };
  const tx = {
    bibleNote: {
      upsert: async (args: unknown) => {
        writes.notes.push(args);
      }
    },
    bibleNoteShare: {
      deleteMany: async (args: unknown) => {
        writes.deletions.push(args);
      },
      create: async (args: unknown) => {
        writes.shares.push(args);
      }
    },
    message: { findUnique: async () => message }
  } as unknown as Prisma.TransactionClient;
  return { tx, writes };
}

const sharedMessage = {
  type: "bible_note",
  payload: { kind: "bible_note", noteId, reference: "约翰福音 11:35" },
  sender: { accountId: 1 }
};

test("Bible note restore upserts metadata and restores a verified message share", async () => {
  const { tx, writes } = transaction(sharedMessage);
  const rows = parseBibleNoteBackup([backup]);
  await importBibleNoteBackup(tx, rows);
  const { shares: _shares, source, ...metadata } = rows[0];
  const data = { ...metadata, source };
  assert.deepEqual(writes.notes, [{ where: { id: noteId }, create: data, update: data }]);
  assert.deepEqual(writes.deletions, [{ where: { noteId } }]);
  assert.deepEqual(writes.shares, [{ data: { noteId, messageId: 7 } }]);
});

test("Bible note restore rejects missing, recalled, mismatched, and other owners' shared messages", async () => {
  for (const message of [
    null,
    { ...sharedMessage, type: "system" },
    { ...sharedMessage, payload: { ...sharedMessage.payload, kind: "bible_copywork" } },
    { ...sharedMessage, payload: { ...sharedMessage.payload, noteId: "other-note" } },
    { ...sharedMessage, sender: { accountId: 2 } }
  ]) {
    const { tx, writes } = transaction(message);
    await assert.rejects(
      importBibleNoteBackup(tx, parseBibleNoteBackup([backup])),
      /笔记分享关联无效/
    );
    assert.deepEqual(writes.shares, []);
  }
});
