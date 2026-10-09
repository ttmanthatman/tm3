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
  let uniqueConflicts = 0;
  let failCreate = false;
  const prisma = {
    book: {
      findUnique: async ({ where }: { where: { id: number } }) => {
        reads++;
        return books.get(where.id) ?? null;
      }
    },
    setting: {
      findMany: async ({ where }: { where: { key: { startsWith: string } } }) => [...rows.values()].filter((row) => row.key.startsWith(where.key.startsWith)),
      findUnique: async ({ where }: { where: { key: string } }) => rows.get(where.key) ?? null,
      create: async ({ data }: { data: { key: string; value: string } }) => {
        if (failCreate) throw new Error("storage unavailable");
        // Let concurrent inject requests reach the database boundary before a
        // create commits, as separate devices can on a real database.
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (rows.has(data.key)) {
          uniqueConflicts++;
          throw new Prisma.PrismaClientKnownRequestError("duplicate key", { code: "P2002", clientVersion: "test" });
        }
        rows.set(data.key, { ...data });
        return data;
      },
      update: async ({ where, data }: { where: { key: string }; data: { value: string } }) => {
        assert.ok(rows.has(where.key));
        const row = { key: where.key, value: data.value };
        rows.set(where.key, row);
        return row;
      },
      deleteMany: async ({ where }: { where: { key: string } }) => ({ count: Number(rows.delete(where.key)) })
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
  return { app, rows, books, reads: () => reads, uniqueConflicts: () => uniqueConflicts, failCreate: () => { failCreate = true; } };
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
  assert.equal(h.uniqueConflicts(), 1);
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
