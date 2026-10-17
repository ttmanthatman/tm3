import assert from "node:assert/strict";
import test from "node:test";
import { bookLocatorSchema, bookProgressWriteSchema } from "./bookLocator.js";
import { bookNoteInputSchema, bookNoteInputV2Schema, bookNoteSchema, legacyBookNote, type BookNoteDTO } from "./bookNotes.js";

const locator = { version: 1, bookId: 1, publicationRevision: "a".repeat(64), textRevision: "epub-text-v1", sectionHref: "OEBPS/ch1.xhtml", start: 2, end: 6,
  quote: { exact: "原文测试", prefix: "前文", suffix: "后文", length: 4 } };
test("persisted locator rejects session-only identity, algorithm mismatch and unsafe or inconsistent bounds", () => {
  assert.equal(bookLocatorSchema.safeParse(locator).success, true);
  for (const value of [
    { ...locator, publicationRevision: null, sessionId: "session" }, { ...locator, textRevision: "future" }, { ...locator, bookId: Infinity },
    { ...locator, start: 6 }, { ...locator, start: -1 }, { ...locator, end: 1.5 }, { ...locator, end: 100000001 },
    { ...locator, sectionHref: "../escape.xhtml" }, { ...locator, sectionHref: "https://other.invalid/ch.xhtml" },
    { ...locator, sectionHref: "ch.xhtml#fragment" }, { ...locator, unexpected: true }, { ...locator, quote: { ...locator.quote, length: 5 } }
  ]) assert.equal(bookLocatorSchema.safeParse(value).success, false);
  assert.equal(bookProgressWriteSchema.safeParse({ fraction: .3, locator, baseRevision: 0, mutationId: "8e8de084-8f73-4b56-8718-27e21ddc82ac" }).success, true);
});
test("v2 notes retain locators while strict legacy payloads receive an explicit projection", () => {
  const note: BookNoteDTO = { quote: "原文测试", text: "想法", chapter: "第一章", fraction: .1, locator: bookLocatorSchema.parse(locator), id: "8e8de084-8f73-4b56-8718-27e21ddc82ac", bookId: 1, bookTitle: "书名", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
  assert.equal(bookNoteSchema.safeParse(note).success, false);
  assert.equal(bookNoteSchema.safeParse(legacyBookNote(note)).success, true);
  assert.equal(legacyBookNote(note).quote, note.quote);
  const input = { quote: note.quote, text: note.text, chapter: note.chapter, fraction: note.fraction, locator: note.locator };
  assert.equal(bookNoteInputV2Schema.safeParse(input).success, true);
  assert.equal(bookNoteInputSchema.safeParse(input).success, false);
});
