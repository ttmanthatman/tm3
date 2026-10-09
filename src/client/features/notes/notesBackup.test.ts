import assert from "node:assert/strict";
import { test } from "node:test";
import type { BibleNoteDTO } from "@shared/bibleNotes";
import type { BookNoteDTO } from "@shared/bookNotes";
import { exportNotesBackup, importNotesBackup, NOTES_BACKUP_MAX_BYTES, NOTES_BACKUP_MAX_COUNT, parseNotesBackup, serializeNotesBackup, type NotesBackup, type NotesBackupClient, type TransferBook } from "./notesBackup";

const at = "2026-10-09T10:00:00.000Z";
const uuid = (index: number) => `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
const source = { translation: "cmn-cu89s", translationName: "和合本", copyright: "公共领域", bookCode: "JHN", chapter: 11, verseStart: 35, verseEnd: 35, reference: "约翰福音 11:35", text: "耶稣哭了。" };
const bibleNote: BibleNoteDTO = { id: uuid(1), accountId: 1, author: "读者", source, text: "祂与我们一同流泪。", createdAt: at, updatedAt: at, publishedAt: at };
const book: TransferBook = { id: 1, title: "示例图书", author: "示例作者" };
const bookNote: BookNoteDTO = { id: uuid(2), bookId: 1, bookTitle: book.title, quote: "记住这一句话。", text: "记住，与人一同读。", chapter: "第 2 章", fraction: .15, createdAt: at, updatedAt: at };

function fixture(accountId = 1) {
  const bible: BibleNoteDTO[] = [];
  const books: TransferBook[] = [book];
  const notes = new Map<number, BookNoteDTO[]>([[1, []]]);
  const bibleWrites: Array<{ id: string; text: string }> = [];
  const bookWrites: Array<{ bookId: number; id: string }> = [];
  let nextId = 100;
  const client: NotesBackupClient = {
    listBible: async (offset) => ({ notes: bible.slice(offset, offset + 2), nextOffset: offset + 2 < bible.length ? offset + 2 : null }),
    createBible: async (id, selection, text) => {
      bibleWrites.push({ id, text });
      const { verse, ...location } = selection;
      const saved: BibleNoteDTO = { ...bibleNote, id, accountId, text, publishedAt: null, source: { ...source, ...location, verseStart: verse, verseEnd: verse } };
      bible.push(saved);
      return { note: saved };
    },
    listBooks: async () => ({ books }),
    listBookNotes: async (id) => ({ notes: notes.get(id) ?? [] }),
    createBook: async (bookId, id, input) => {
      bookWrites.push({ bookId, id });
      const saved = { ...bookNote, ...input, id, bookId, bookTitle: books.find((item) => item.id === bookId)!.title };
      notes.set(bookId, [...(notes.get(bookId) ?? []), saved]);
      return { note: saved };
    }
  };
  return { client, bible, books, notes, bibleWrites, bookWrites, options: { now: () => at, newId: () => uuid(nextId++) } };
}
async function bibleBackup(): Promise<NotesBackup> {
  const f = fixture(); f.bible.push(bibleNote);
  return exportNotesBackup("bible", 1, f.client, f.options);
}
async function booksBackup(): Promise<NotesBackup> {
  const f = fixture(); f.notes.set(1, [bookNote]);
  return exportNotesBackup("books", 1, f.client, f.options);
}

test("Bible export reads every own page, preserves source and content, and roundtrips JSON", async () => {
  const f = fixture();
  f.bible.push(...[1, 2, 3, 4, 5].map((id) => ({ ...bibleNote, id: uuid(id), text: `领受 ${id}` })));
  const offsets: number[] = [];
  const list = f.client.listBible;
  f.client.listBible = async (offset) => { offsets.push(offset); return list(offset); };
  const backup = await exportNotesBackup("bible", 1, f.client, f.options);
  assert.deepEqual(offsets, [0, 2, 4]);
  assert.equal(backup.notes.length, 5);
  assert.deepEqual(parseNotesBackup(serializeNotesBackup(backup), "bible"), backup);
  assert.equal(backup.domain, "bible");
  if (backup.domain === "bible") assert.deepEqual(backup.notes[0].source, source);
  assert.equal("author" in backup.notes[0], false);
});

test("Bible export refuses someone else's note or invalid repeated pagination", async () => {
  const f = fixture(); f.bible.push({ ...bibleNote, accountId: 2 });
  await assert.rejects(exportNotesBackup("bible", 1, f.client, f.options), /账号不符/);
  f.client.listBible = async () => ({ notes: [bibleNote], nextOffset: 0 });
  await assert.rejects(exportNotesBackup("bible", 1, f.client, f.options), /分页无效/);
});

test("ebook export includes own notes from the whole catalog, including books with no notes", async () => {
  const f = fixture(); f.books.push({ id: 2, title: "空书", author: "另一作者" }, { ...book, id: 3, title: "另一图书" });
  f.notes.set(1, [bookNote]); f.notes.set(3, [{ ...bookNote, bookId: 3, bookTitle: "另一图书", id: uuid(3), quote: "另一段文字" }]);
  const read: number[] = [];
  const list = f.client.listBookNotes;
  f.client.listBookNotes = async (id) => { read.push(id); return list(id); };
  const backup = await exportNotesBackup("books", 1, f.client, f.options);
  assert.deepEqual(read, [1, 2, 3]);
  assert.equal(backup.notes.length, 2);
  assert.deepEqual(parseNotesBackup(serializeNotesBackup(backup), "books"), backup);
  assert.equal(backup.domain, "books");
  if (backup.domain === "books") assert.deepEqual(backup.notes[0], { ...bookNote, bookAuthor: book.author });
});

test("exports fail instead of downloading partial or mismatched book inventories", async () => {
  const f = fixture(); f.books.push({ ...book, id: 2 });
  f.client.listBookNotes = async (id) => { if (id === 2) throw new Error("网络中断"); return { notes: [bookNote] }; };
  await assert.rejects(exportNotesBackup("books", 1, f.client, f.options), /网络中断/);
  f.client.listBookNotes = async () => ({ notes: [{ ...bookNote, bookId: 99 }] });
  await assert.rejects(exportNotesBackup("books", 1, f.client, f.options), /来源不符/);
});

test("parser rejects malformed, wrong-domain, unknown-field, invalid-location and duplicate-ID files", async () => {
  const backup = await bibleBackup();
  assert.throws(() => parseNotesBackup("not JSON", "bible"), /JSON/);
  assert.throws(() => parseNotesBackup(JSON.stringify(backup), "books"), /电子书/);
  for (const value of [
    { ...backup, version: 2 }, { ...backup, surprise: true },
    { ...backup, notes: [{ ...backup.notes[0], surprise: true }] },
    { ...backup, notes: [{ ...backup.notes[0], source: { ...source, verseEnd: 36 } }] },
    { ...backup, notes: [{ ...backup.notes[0], text: "   " }] },
    { ...backup, notes: [{ ...backup.notes[0], id: "not-uuid" }] }
  ]) assert.throws(() => parseNotesBackup(JSON.stringify(value), "bible"), /格式无效/);
  assert.throws(() => parseNotesBackup(JSON.stringify({ ...backup, notes: [...backup.notes, ...backup.notes] }), "bible"), /重复编号/);
  const books = await booksBackup();
  assert.throws(() => parseNotesBackup(JSON.stringify({ ...books, notes: [{ ...books.notes[0], fraction: 2 }] }), "books"), /格式无效/);
});

test("parser bounds bytes and count before any API writes", async () => {
  assert.throws(() => parseNotesBackup(" ".repeat(NOTES_BACKUP_MAX_BYTES + 1), "bible"), /10 MB/);
  const backup = await bibleBackup();
  assert.throws(() => parseNotesBackup(JSON.stringify({ ...backup, notes: Array(NOTES_BACKUP_MAX_COUNT + 1).fill(backup.notes[0]) }), "bible"), /格式无效/);
  const f = fixture();
  await assert.rejects(importNotesBackup({ ...backup, notes: [{ ...backup.notes[0], text: "" }] } as NotesBackup, 1, f.client, f.options), /格式无效/);
  assert.deepEqual(f.bibleWrites, []);
});

test("portable Bible import creates only private notes under current account using fresh IDs", async () => {
  const backup = await bibleBackup();
  const f = fixture(2);
  const result = await importNotesBackup(backup, 2, f.client, f.options);
  assert.deepEqual(result, { imported: 1, duplicates: 0, conflicts: 0, unavailable: 0, remaining: 0, error: "" });
  assert.equal(f.bible[0].accountId, 2);
  assert.equal(f.bible[0].publishedAt, null);
  assert.notEqual(f.bible[0].id, bibleNote.id);
  assert.equal(f.bible[0].text, bibleNote.text);
  assert.equal(f.bible[0].source.verseStart, 35);
  assert.equal(f.bible[0].source.chapter, 11);
});

test("Bible imports skip duplicate content/location and conflicting own IDs without any mutation", async () => {
  const backup = await bibleBackup();
  const duplicate = fixture(); duplicate.bible.push({ ...bibleNote, id: uuid(99) });
  assert.equal((await importNotesBackup(backup, 1, duplicate.client, duplicate.options)).duplicates, 1);
  assert.deepEqual(duplicate.bibleWrites, []);
  const conflict = fixture(); conflict.bible.push({ ...bibleNote, text: "这是我后来修改的领受" });
  assert.equal((await importNotesBackup(backup, 1, conflict.client, conflict.options)).conflicts, 1);
  assert.equal(conflict.bible[0].text, "这是我后来修改的领受");
  assert.deepEqual(conflict.bibleWrites, []);
});

test("ebook imports match portable book identities and preserve quote, chapter and fraction", async () => {
  const backup = await booksBackup();
  const f = fixture(2); f.books.splice(0, 1, { ...book, id: 8 });
  const result = await importNotesBackup(backup, 2, f.client, f.options);
  assert.equal(result.imported, 1);
  assert.equal(f.bookWrites[0].bookId, 8);
  assert.notEqual(f.bookWrites[0].id, bookNote.id);
  const saved = f.notes.get(8)![0];
  assert.equal(saved.quote, bookNote.quote);
  assert.equal(saved.chapter, bookNote.chapter);
  assert.equal(saved.fraction, bookNote.fraction);
  assert.equal(saved.text, bookNote.text);
});

test("ebook import skips missing or ambiguous books and never matches an unrelated reused ID", async () => {
  const backup = await booksBackup();
  const f = fixture(); f.books.splice(0, 1, { id: 1, title: "另一图书", author: "另一个人" });
  assert.equal((await importNotesBackup(backup, 1, f.client, f.options)).unavailable, 1);
  f.books.push({ ...book, id: 7 }, { ...book, id: 8 });
  assert.equal((await importNotesBackup(backup, 1, f.client, f.options)).unavailable, 1);
  assert.deepEqual(f.bookWrites, []);
});

test("ebook duplicate and conflict checks do not overwrite existing notes", async () => {
  const backup = await booksBackup();
  const f = fixture(); f.notes.set(1, [{ ...bookNote, id: uuid(88) }]);
  assert.equal((await importNotesBackup(backup, 1, f.client, f.options)).duplicates, 1);
  f.notes.set(1, [{ ...bookNote, text: "新的个人笔记" }]);
  assert.equal((await importNotesBackup(backup, 1, f.client, f.options)).conflicts, 1);
  assert.equal(f.notes.get(1)![0].text, "新的个人笔记");
  assert.deepEqual(f.bookWrites, []);
});

test("Bible partial failure and retry retain successful notes without duplicates", async () => {
  const origin = fixture(); origin.bible.push(bibleNote, { ...bibleNote, id: uuid(3), text: "第二篇领受" });
  const backup = await exportNotesBackup("bible", 1, origin.client, origin.options);
  const f = fixture();
  const create = f.client.createBible;
  let failed = false;
  f.client.createBible = async (...args) => { if (args[2] === "第二篇领受" && !failed) { failed = true; throw new Error("网络中断"); } return create(...args); };
  const partial = await importNotesBackup(backup, 1, f.client, f.options);
  assert.equal(partial.imported, 1); assert.equal(partial.remaining, 1); assert.equal(partial.error, "网络中断");
  const retry = await importNotesBackup(backup, 1, f.client, f.options);
  assert.equal(retry.imported, 1); assert.equal(retry.duplicates, 1); assert.equal(retry.remaining, 0);
  assert.equal(f.bible.length, 2);
});

test("ebook retries recover a saved note whose first network response was lost", async () => {
  const backup = await booksBackup();
  const f = fixture();
  const create = f.client.createBook;
  f.client.createBook = async (...args) => { await create(...args); throw new Error("响应丢失"); };
  const partial = await importNotesBackup(backup, 1, f.client, f.options);
  assert.equal(partial.imported, 0); assert.equal(partial.remaining, 1); assert.equal(partial.error, "响应丢失");
  const retry = await importNotesBackup(backup, 1, f.client, f.options);
  assert.equal(retry.duplicates, 1); assert.equal(retry.error, ""); assert.equal(f.bookWrites.length, 1);
});

test("all affected ebook inventories must load before importing any notes", async () => {
  const origin = fixture(); origin.books.push({ ...book, id: 2, title: "第二本" });
  origin.notes.set(1, [bookNote]); origin.notes.set(2, [{ ...bookNote, bookId: 2, bookTitle: "第二本", id: uuid(3) }]);
  const backup = await exportNotesBackup("books", 1, origin.client, origin.options);
  const f = fixture(); f.books.push(origin.books[1]);
  f.client.listBookNotes = async (id) => { if (id === 2) throw new Error("无法读取已有笔记"); return { notes: [] }; };
  await assert.rejects(importNotesBackup(backup, 1, f.client, f.options), /无法读取/);
  assert.deepEqual(f.bookWrites, []);
});

test("account changes stop transfer before further writes", async () => {
  const origin = fixture(); origin.bible.push(bibleNote, { ...bibleNote, id: uuid(2), text: "第二篇" });
  const backup = await exportNotesBackup("bible", 1, origin.client, origin.options);
  const f = fixture();
  let active = true;
  const create = f.client.createBible;
  f.client.createBible = async (...args) => { const saved = await create(...args); active = false; return saved; };
  await assert.rejects(importNotesBackup(backup, 1, f.client, { ...f.options, assertActive: () => { if (!active) throw new Error("账号切换"); } }), /账号切换/);
  assert.equal(f.bibleWrites.length, 1);
});

test("generated ID collision is rejected and unexpected public Bible import is reported", async () => {
  const backup = await bibleBackup();
  const f = fixture(); f.bible.push({ ...bibleNote, id: uuid(99), text: "另一篇" });
  const collision = await importNotesBackup(backup, 1, f.client, { ...f.options, newId: () => uuid(99) });
  assert.match(collision.error, /编号冲突/); assert.deepEqual(f.bibleWrites, []);
  const create = f.client.createBible;
  f.client.createBible = async (...args) => ({ note: { ...(await create(...args)).note, publishedAt: at } });
  assert.match((await importNotesBackup(backup, 1, f.client, f.options)).error, /导入结果不符/);
});
