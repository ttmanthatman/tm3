import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, type PrismaClient } from "@prisma/client";
import Fastify, { type FastifyRequest } from "fastify";
import { BOOK_NOTE_CHAPTER_MAX, BOOK_NOTE_TEXT_MAX, BOOK_QUOTE_MAX, type BookNoteDTO } from "../../shared/bookNotes.js";
import { bookNotesSettingPrefix } from "../services/bookNotes.js";
import { registerBookNotesRoutes } from "./bookNotes.js";

const noteId = "312edcba-d5ae-4a3a-a35b-c805e4a56a00";
const secondId = "7fdc9921-463c-4dcc-bf2c-b0ee8be44b13";
const input = { quote: "书中的一句话", text: "读到这里的想法", chapter: "第一章", fraction: 0.25 };
const headers = { authorization: "Bearer 7" };

function createHarness() {
  const rows = new Map<string, { key: string; value: string }>();
  const books = new Map([[1, { id: 1, title: "正式书名" }], [10, { id: 10, title: "另一本书" }]]);
  let reads = 0;
  let transactions = 0;
  const transactionErrors: string[] = [];
  let failCreate = false, failParts = false;
  type Where = { key?: string | { startsWith: string }; OR?: Where[] };
  const matches = (key: string, where: Where): boolean => where.OR ? where.OR.some((item) => matches(key, item)) : typeof where.key === "string" ? key === where.key : key.startsWith(where.key?.startsWith ?? "");
  const setting = {
    findMany: async ({ where }: { where: Where }) => [...rows.values()].filter((row) => matches(row.key, where)),
    upsert: async ({ where, create }: { where: { key: string }; create: { key: string; value: string } }) => {
      if (failCreate) throw new Error("storage unavailable");
      if (!rows.has(where.key)) rows.set(where.key, { ...create });
      return rows.get(where.key)!;
    },
    createMany: async ({ data }: { data: { key: string; value: string }[] }) => {
      if (failParts) throw new Error("part storage unavailable");
      for (const row of data) rows.set(row.key, { ...row });
      return { count: data.length };
    },
    update: async ({ where, data }: { where: { key: string }; data: { value: string } }) => {
      assert.ok(rows.has(where.key));
      const row = { key: where.key, value: data.value }; rows.set(where.key, row); return row;
    },
    deleteMany: async ({ where }: { where: Where }) => {
      let count = 0;
      for (const key of rows.keys()) if (matches(key, where)) { rows.delete(key); count++; }
      return { count };
    }
  };
  let pending = Promise.resolve();
  const prisma = {
    book: { findUnique: async ({ where }: { where: { id: number } }) => { reads++; return books.get(where.id) ?? null; } },
    setting,
    $transaction<T>(action: (tx: { setting: typeof setting }) => Promise<T>): Promise<T> {
      const operation = pending.then(async () => {
        transactions++;
        const code = transactionErrors.shift();
        if (code) throw new Prisma.PrismaClientKnownRequestError("retry transaction", { code, clientVersion: "test" });
        const before = new Map(rows);
        try { return await action({ setting }); }
        catch (error) { rows.clear(); for (const [key, value] of before) rows.set(key, value); throw error; }
      });
      pending = operation.then(() => undefined, () => undefined);
      return operation;
    }
  };
  const app = Fastify();
  const accountIdFor = (request: FastifyRequest) => Number(request.headers.authorization?.replace("Bearer ", ""));
  registerBookNotesRoutes(app, {
    prisma: prisma as unknown as PrismaClient,
    requireAuth: async (request, reply) => {
      if (![7, 70, 8].includes(accountIdFor(request))) return reply.code(401).send({ success: false });
    },
    authFor: (request) => ({ accountId: accountIdFor(request), isAdmin: false })
  });
  return { app, rows, books, transactionErrors, reads: () => reads, transactions: () => transactions, failCreate: () => { failCreate = true; }, failParts: (value: boolean) => { failParts = value; } };
}

test("book notes require authentication before reading or changing private data", async (t) => {
  const h = createHarness();
  t.after(() => h.app.close());
  for (const method of ["GET", "PUT", "DELETE"] as const) {
    const response = await h.app.inject({ method, url: `/api/books/1/notes${method === "GET" ? "" : `/${noteId}`}`, ...(method === "PUT" ? { payload: input } : {}) });
    assert.equal(response.statusCode, 401);
  }
  assert.equal(h.reads(), 0);
  assert.equal(h.rows.size, 0);
});

test("book notes return the declared shape, canonical title and stable creation date across retries and edits", async (t) => {
  const h = createHarness();
  t.after(() => h.app.close());
  const url = `/api/books/1/notes/${noteId}`;
  const created = await h.app.inject({ method: "PUT", url, headers, payload: input });
  assert.equal(created.statusCode, 200);
  assert.equal(created.headers["cache-control"], "private, no-store");
  const note = created.json<{ note: BookNoteDTO }>().note;
  assert.deepEqual(note, { ...input, id: noteId, bookId: 1, bookTitle: "正式书名", createdAt: note.createdAt, updatedAt: note.updatedAt });
  assert.equal(Number.isNaN(Date.parse(note.createdAt)), false);
  assert.equal(note.createdAt, note.updatedAt);
  const retried = await h.app.inject({ method: "PUT", url: `/api/books/1/notes/${noteId.toUpperCase()}`, headers, payload: input });
  assert.equal(retried.statusCode, 200);
  assert.equal(h.rows.size, 1);
  assert.equal(retried.json().note.createdAt, note.createdAt);
  const key = `${bookNotesSettingPrefix(7, 1)}${noteId}`;
  h.rows.set(key, { key, value: JSON.stringify({ ...note, createdAt: "2020-01-01T00:00:00.000Z" }) });
  h.books.set(1, { id: 1, title: "修正后的书名" });
  const edited = await h.app.inject({ method: "PUT", url, headers, payload: { ...input, text: "新的心得", fraction: 0.8 } });
  assert.equal(edited.statusCode, 200);
  assert.equal(edited.json().note.createdAt, "2020-01-01T00:00:00.000Z");
  assert.equal(edited.json().note.bookTitle, "修正后的书名");
  assert.equal(edited.json().note.text, "新的心得");
  const listed = await h.app.inject({ method: "GET", url: "/api/books/1/notes", headers });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.headers["cache-control"], "private, no-store");
  assert.deepEqual(listed.json(), { notes: [edited.json().note] });
});

test("private note keys isolate accounts and books for reads, updates and deletes", async (t) => {
  const h = createHarness();
  t.after(() => h.app.close());
  const url = `/api/books/1/notes/${noteId}`;
  await h.app.inject({ method: "PUT", url, headers, payload: input });
  await h.app.inject({ method: "PUT", url, headers: { authorization: "Bearer 70" }, payload: { ...input, text: "其他人的笔记" } });
  await h.app.inject({ method: "PUT", url: `/api/books/10/notes/${noteId}`, headers, payload: { ...input, text: "另一本书的笔记" } });
  const empty = await h.app.inject({ method: "GET", url: "/api/books/1/notes", headers: { authorization: "Bearer 8" } });
  assert.deepEqual(empty.json(), { notes: [] });
  const mine = await h.app.inject({ method: "GET", url: "/api/books/1/notes", headers });
  assert.equal(mine.json().notes.length, 1);
  assert.equal(mine.json().notes[0].text, input.text);
  const otherDelete = await h.app.inject({ method: "DELETE", url, headers: { authorization: "Bearer 8" } });
  assert.deepEqual(otherDelete.json(), { success: true });
  assert.equal(h.rows.size, 3);
  const removed = await h.app.inject({ method: "DELETE", url, headers });
  assert.equal(removed.statusCode, 200);
  assert.deepEqual(removed.json(), { success: true });
  assert.equal(removed.headers["cache-control"], "private, no-store");
  assert.equal(h.rows.size, 2);
  const other = await h.app.inject({ method: "GET", url: "/api/books/1/notes", headers: { authorization: "Bearer 70" } });
  assert.equal(other.json().notes[0].text, "其他人的笔记");
  assert.deepEqual((await h.app.inject({ method: "DELETE", url, headers })).json(), { success: true });
});

test("distinct simultaneous notes survive, same UUID races converge, and list sorts latest edits first", async (t) => {
  const h = createHarness();
  t.after(() => h.app.close());
  const saved = await Promise.all([noteId, noteId, secondId].map((id) => h.app.inject({ method: "PUT", url: `/api/books/1/notes/${id}`, headers, payload: input })));
  assert.deepEqual(saved.map((response) => response.statusCode), [200, 200, 200]);
  assert.equal(h.rows.size, 2);
  assert.equal(h.transactions(), 3);
  assert.equal(saved[0].json().note.createdAt, saved[1].json().note.createdAt);
  const firstKey = `${bookNotesSettingPrefix(7, 1)}${noteId}`;
  h.rows.set(firstKey, { key: firstKey, value: JSON.stringify({ ...saved[0].json().note, updatedAt: "2000-01-01T00:00:00.000Z" }) });
  const listed = await h.app.inject({ method: "GET", url: "/api/books/1/notes", headers });
  assert.deepEqual(listed.json().notes.map((note: BookNoteDTO) => note.id), [secondId, noteId]);
});

test("book notes reject malformed identifiers, invalid bodies and encoded values beyond storage capacity", async (t) => {
  const h = createHarness();
  t.after(() => h.app.close());
  for (const id of ["0", "-1", "1.5", "Infinity", "2147483648", "not-a-book"]) {
    assert.equal((await h.app.inject({ method: "GET", url: `/api/books/${id}/notes`, headers })).statusCode, 400);
  }
  assert.equal((await h.app.inject({ method: "PUT", url: "/api/books/1/notes/not-a-uuid", headers, payload: input })).statusCode, 400);
  assert.equal((await h.app.inject({ method: "DELETE", url: "/api/books/1/notes/not-a-uuid", headers })).statusCode, 400);
  for (const payload of [
    {}, { ...input, quote: "   " }, { ...input, quote: "x".repeat(BOOK_QUOTE_MAX + 1) },
    { ...input, text: "x".repeat(BOOK_NOTE_TEXT_MAX + 1) }, { ...input, chapter: "x".repeat(BOOK_NOTE_CHAPTER_MAX + 1) },
    { ...input, fraction: -0.01 }, { ...input, fraction: 1.01 }, { ...input, fraction: "0.25" },
    { ...input, fraction: null }, { ...input, quote: 123 }, { ...input, text: null },
    { ...input, accountId: 8 }, { ...input, bookTitle: "伪造书名" },
    { ...input, quote: "\u0000".repeat(BOOK_QUOTE_MAX), text: "\u0000".repeat(BOOK_NOTE_TEXT_MAX) }
  ]) {
    const response = await h.app.inject({ method: "PUT", url: `/api/books/1/notes/${noteId}`, headers, payload });
    assert.equal(response.statusCode, 400);
  }
  assert.equal(h.rows.size, 0);
});

test("book notes accept excerpt-only notes, boundary fractions and maximum ordinary text", async (t) => {
  const h = createHarness();
  t.after(() => h.app.close());
  const emptyText = await h.app.inject({ method: "PUT", url: `/api/books/1/notes/${noteId}`, headers, payload: { ...input, text: "", chapter: "", fraction: 0 } });
  assert.equal(emptyText.statusCode, 200);
  const maximum = await h.app.inject({ method: "PUT", url: `/api/books/1/notes/${secondId}`, headers, payload: { quote: "摘".repeat(BOOK_QUOTE_MAX), text: "记".repeat(BOOK_NOTE_TEXT_MAX), chapter: "章".repeat(BOOK_NOTE_CHAPTER_MAX), fraction: 1 } });
  assert.equal(maximum.statusCode, 200);
});

test("all note operations reject a missing or deleted book without mutating saved notes", async (t) => {
  const h = createHarness();
  t.after(() => h.app.close());
  await h.app.inject({ method: "PUT", url: `/api/books/1/notes/${noteId}`, headers, payload: input });
  h.books.delete(1);
  for (const bookId of [1, 999]) {
    for (const method of ["GET", "PUT", "DELETE"] as const) {
      const response = await h.app.inject({ method, url: `/api/books/${bookId}/notes${method === "GET" ? "" : `/${noteId}`}`, headers, ...(method === "PUT" ? { payload: input } : {}) });
      assert.equal(response.statusCode, 404);
      assert.equal(response.json().message, "图书不存在");
    }
  }
  assert.equal(h.rows.size, 1);
});

test("storage failure cannot report a saved note", async (t) => {
  const h = createHarness();
  t.after(() => h.app.close());
  h.failCreate();
  const response = await h.app.inject({ method: "PUT", url: `/api/books/1/notes/${noteId}`, headers, payload: input });
  assert.equal(response.statusCode, 500);
  assert.equal(h.rows.size, 0);
});

const ink = { kind: "handwriting" as const, version: 1 as const, characters: [{ strokes: [{ color: "#123456" as const, points: [[1000, 2000, 0], [3000, 4000, 25]] as [number, number, number][] }] }] };
test("handwritten drafts survive reads, edits and deletion; malformed ink cannot replace a note", async (t) => {
  const h = createHarness(); t.after(() => h.app.close());
  const url = `/api/books/1/notes/${noteId}`;
  const saved = await h.app.inject({ method: "PUT", url, headers, payload: { ...input, text: "", handwriting: ink, draft: true } });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.json().note.handwriting, ink);
  assert.equal(saved.json().note.draft, true);
  for (const handwriting of [{ ...ink, version: 99 }, { ...ink, characters: [] }, { ...ink, url: "https://invalid.example/" }]) {
    assert.equal((await h.app.inject({ method: "PUT", url, headers, payload: { ...input, handwriting } })).statusCode, 400);
  }
  const listed = await h.app.inject({ method: "GET", url: "/api/books/1/notes", headers });
  assert.deepEqual(listed.json().notes[0].handwriting, ink);
  await h.app.inject({ method: "DELETE", url, headers });
  assert.equal(h.rows.size, 0);
});

test("large handwriting uses bounded atomic parts, preserves Unicode and rolls back a failed replacement", async (t) => {
  const h = createHarness(); t.after(() => h.app.close());
  const url = `/api/books/1/notes/${noteId}`;
  const handwriting = { ...ink, characters: [{ strokes: [{ color: "#123456", points: Array.from({ length: 8000 }, (_, index) => [index, 5000, index]) }] }] };
  const payload = { ...input, text: "😀".repeat(5000), handwriting, draft: true };
  const saved = await h.app.inject({ method: "PUT", url, headers, payload });
  assert.equal(saved.statusCode, 200);
  assert.ok(h.rows.size > 2);
  assert.ok([...h.rows.values()].every((row) => Buffer.byteLength(row.value) <= 60 * 1024));
  assert.deepEqual((await h.app.inject({ method: "GET", url: "/api/books/1/notes", headers })).json().notes, [saved.json().note]);
  h.failParts(true);
  const failed = await h.app.inject({ method: "PUT", url, headers, payload: { ...payload, text: "replacement" } });
  assert.equal(failed.statusCode, 500);
  assert.deepEqual((await h.app.inject({ method: "GET", url: "/api/books/1/notes", headers })).json().notes, [saved.json().note]);
  h.failParts(false);
  const small = await h.app.inject({ method: "PUT", url, headers, payload: input });
  assert.equal(small.statusCode, 200); assert.equal(h.rows.size, 1);
  assert.equal(small.json().note.createdAt, saved.json().note.createdAt);
  await h.app.inject({ method: "PUT", url, headers, payload });
  await h.app.inject({ method: "DELETE", url, headers });
  assert.equal(h.rows.size, 0);
});

test("transaction uniqueness and deadlock races retry atomically with one stable note", async (t) => {
  const h = createHarness(); t.after(() => h.app.close());
  h.transactionErrors.push("P2002", "P2034");
  const saved = await h.app.inject({ method: "PUT", url: `/api/books/1/notes/${noteId}`, headers, payload: input });
  assert.equal(saved.statusCode, 200); assert.equal(h.transactions(), 3); assert.equal(h.rows.size, 1);
  h.transactionErrors.push("P2034", "P2034", "P2034");
  const failed = await h.app.inject({ method: "PUT", url: `/api/books/1/notes/${noteId}`, headers, payload: { ...input, text: "未保存" } });
  assert.equal(failed.statusCode, 500);
  assert.deepEqual((await h.app.inject({ method: "GET", url: "/api/books/1/notes", headers })).json().notes, [saved.json().note]);
});
