import assert from "node:assert/strict";
import test from "node:test";
import { bookNoteHasContent, bookNoteSharePayload, bookNoteShareSchema } from "./bookNotes.js";
const note = { id: "312edcba-d5ae-4a3a-a35b-c805e4a56a00", bookId: 1, bookTitle: "示例", quote: "原文", text: "想法", chapter: "第一章", fraction: .2, createdAt: "2026-10-15T00:00:00Z", updatedAt: "2026-10-15T00:00:00Z" };
test("shared notes carry a validated snapshot without private account metadata or arbitrary ink", () => {
  assert.deepEqual(bookNoteSharePayload({ kind: "book_note", note }), { kind: "book_note", note });
  for (const value of [null, { kind: "other", note }, { kind: "book_note", note: { ...note, accountId: 2 } }, { kind: "book_note", note: { ...note, fraction: 2 } }, { kind: "book_note", note: { ...note, handwriting: { kind: "handwriting", version: 99 } } }]) {
    assert.equal(bookNoteSharePayload(value), null); assert.equal(bookNoteShareSchema.safeParse(value).success, false);
  }
  assert.equal(bookNoteHasContent({ text: "  \n", handwriting: null }), false);
});
