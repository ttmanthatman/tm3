import { z } from "zod";
import { BIBLE_NOTE_TEXT_MAX, type BibleNoteDTO, type BibleNoteSelection } from "@shared/bibleNotes";
import { BOOK_NOTE_CHAPTER_MAX, BOOK_NOTE_TEXT_MAX, BOOK_QUOTE_MAX, type BookNoteDTO, type BookNoteInput } from "@shared/bookNotes";

export const NOTES_BACKUP_MAX_BYTES = 10 * 1024 * 1024;
export const NOTES_BACKUP_MAX_COUNT = 5000;
export type NotesDomain = "bible" | "books";
const integer = z.number().int().positive().safe();
const date = z.string().datetime({ offset: true });
const sourceSchema = z.object({
  translation: z.string().min(1).max(30), translationName: z.string().max(200),
  copyright: z.string().max(2000), bookCode: z.string().length(3), chapter: integer,
  verseStart: integer, verseEnd: integer, reference: z.string().min(1).max(300),
  text: z.string().min(1).max(BIBLE_NOTE_TEXT_MAX)
}).strict().refine((source) => source.verseStart === source.verseEnd, "只支持单节经文笔记");
const bibleNoteSchema = z.object({
  id: z.string().uuid().transform((id) => id.toLowerCase()), source: sourceSchema,
  text: z.string().trim().min(1).max(BIBLE_NOTE_TEXT_MAX), createdAt: date, updatedAt: date,
  publishedAt: date.nullable()
}).strict();
const bookNoteSchema = z.object({
  id: z.string().uuid().transform((id) => id.toLowerCase()), bookId: integer,
  bookTitle: z.string().min(1).max(200), bookAuthor: z.string().max(120),
  quote: z.string().trim().min(1).max(BOOK_QUOTE_MAX), text: z.string().trim().max(BOOK_NOTE_TEXT_MAX),
  chapter: z.string().trim().max(BOOK_NOTE_CHAPTER_MAX), fraction: z.number().finite().min(0).max(1),
  createdAt: date, updatedAt: date
}).strict();
const header = { format: z.literal("team-chat-notes"), version: z.literal(1), accountId: integer, exportedAt: date };
const backupSchema = z.discriminatedUnion("domain", [
  z.object({ ...header, domain: z.literal("bible"), notes: z.array(bibleNoteSchema).max(NOTES_BACKUP_MAX_COUNT) }).strict(),
  z.object({ ...header, domain: z.literal("books"), notes: z.array(bookNoteSchema).max(NOTES_BACKUP_MAX_COUNT) }).strict()
]);
export type NotesBackup = z.infer<typeof backupSchema>;
type BibleBackupNote = z.infer<typeof bibleNoteSchema>;
type BookBackupNote = z.infer<typeof bookNoteSchema>;
export type TransferBook = { id: number; title: string; author: string };
export interface NotesBackupClient {
  listBible(offset: number): Promise<{ notes: BibleNoteDTO[]; nextOffset: number | null }>;
  createBible(id: string, selection: BibleNoteSelection, text: string): Promise<{ note: BibleNoteDTO }>;
  listBooks(): Promise<{ books: TransferBook[] }>;
  listBookNotes(bookId: number): Promise<{ notes: BookNoteDTO[] }>;
  createBook(bookId: number, id: string, note: BookNoteInput): Promise<{ note: BookNoteDTO }>;
}
export type ImportResult = { imported: number; duplicates: number; conflicts: number; unavailable: number; remaining: number; error: string };
export type TransferOptions = { assertActive?: () => void; newId?: () => string; now?: () => string };

function assertCount(count: number) {
  if (count > NOTES_BACKUP_MAX_COUNT) throw new Error(`笔记超过 ${NOTES_BACKUP_MAX_COUNT} 条，无法一次备份`);
}
function assertSize(text: string) {
  if (new TextEncoder().encode(text).byteLength > NOTES_BACKUP_MAX_BYTES) throw new Error("笔记文件不能超过 10 MB");
}
function checkedBackup(value: unknown): NotesBackup {
  const parsed = backupSchema.safeParse(value);
  if (!parsed.success) throw new Error("笔记文件格式无效或内容超过限制，请选择本应用导出的 JSON 文件");
  const identities = new Set<string>();
  for (const note of parsed.data.notes) {
    const key = parsed.data.domain === "books" ? `${(note as BookBackupNote).bookId}:${note.id}` : note.id;
    if (identities.has(key)) throw new Error("笔记文件包含重复编号，请重新导出");
    identities.add(key);
  }
  return parsed.data;
}
export function parseNotesBackup(text: string, domain: NotesDomain): NotesBackup {
  assertSize(text);
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new Error("无法读取笔记文件，请选择有效的 JSON 文件"); }
  const backup = checkedBackup(value);
  if (backup.domain !== domain) throw new Error(domain === "bible" ? "请选择圣经笔记备份" : "请选择电子书笔记备份");
  return backup;
}
export function serializeNotesBackup(backup: NotesBackup): string {
  const text = JSON.stringify(checkedBackup(backup), null, 2);
  assertSize(text);
  return text;
}
function bibleBackupNote(note: BibleNoteDTO): BibleBackupNote {
  return bibleNoteSchema.parse({ id: note.id, source: note.source, text: note.text, createdAt: note.createdAt, updatedAt: note.updatedAt, publishedAt: note.publishedAt });
}
function bookBackupNote(note: BookNoteDTO, book: TransferBook): BookBackupNote {
  if (note.bookId !== book.id) throw new Error("图书笔记来源不符，已停止备份");
  return bookNoteSchema.parse({ ...note, bookTitle: book.title, bookAuthor: book.author });
}
async function ownBibleNotes(accountId: number, client: NotesBackupClient, active: () => void): Promise<BibleBackupNote[]> {
  const notes = new Map<string, BibleBackupNote>();
  let offset = 0;
  for (;;) {
    active();
    const page = await client.listBible(offset);
    active();
    for (const note of page.notes) {
      if (note.accountId !== accountId) throw new Error("笔记账号不符，已停止备份");
      const item = bibleBackupNote(note);
      notes.set(item.id, item);
      assertCount(notes.size);
    }
    if (page.nextOffset === null) return [...notes.values()];
    if (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset || page.nextOffset > 100000 || !page.notes.length) throw new Error("笔记分页无效，请刷新后重试");
    offset = page.nextOffset;
  }
}
async function bookCatalog(client: NotesBackupClient, active: () => void) {
  active();
  const { books } = await client.listBooks();
  active();
  if (books.length > NOTES_BACKUP_MAX_COUNT || new Set(books.map((book) => book.id)).size !== books.length) throw new Error("图书列表无效，请刷新后重试");
  return books;
}
export async function exportNotesBackup(domain: NotesDomain, accountId: number, client: NotesBackupClient, options: TransferOptions = {}): Promise<NotesBackup> {
  const active = options.assertActive ?? (() => {});
  const metadata = { format: "team-chat-notes" as const, version: 1 as const, accountId, exportedAt: (options.now ?? (() => new Date().toISOString()))() };
  if (domain === "bible") return checkedBackup({ ...metadata, domain, notes: await ownBibleNotes(accountId, client, active) });
  const books = await bookCatalog(client, active);
  const notes: BookBackupNote[] = [];
  for (const book of books) {
    active();
    const result = await client.listBookNotes(book.id);
    active();
    notes.push(...result.notes.map((note) => bookBackupNote(note, book)));
    assertCount(notes.length);
  }
  return checkedBackup({ ...metadata, domain, notes });
}
function bibleContent(note: BibleBackupNote): string {
  const { translation, bookCode, chapter, verseStart } = note.source;
  return JSON.stringify([translation, bookCode, chapter, verseStart, note.text]);
}
function bookContent(note: BookNoteInput): string {
  return JSON.stringify([note.quote, note.text, note.chapter, note.fraction]);
}
function bookForNote(note: BookBackupNote, books: TransferBook[]): TransferBook | undefined {
  const matches = books.filter((book) => book.title === note.bookTitle && book.author === note.bookAuthor);
  return matches.find((book) => book.id === note.bookId) ?? (matches.length === 1 ? matches[0] : undefined);
}

/** Never updates a note. Fresh IDs also isolate imports from edits to the original IDs on another device. */
export async function importNotesBackup(value: NotesBackup, accountId: number, client: NotesBackupClient, options: TransferOptions = {}): Promise<ImportResult> {
  const backup = checkedBackup(value);
  const active = options.assertActive ?? (() => {});
  const newId = options.newId ?? (() => crypto.randomUUID());
  const result: ImportResult = { imported: 0, duplicates: 0, conflicts: 0, unavailable: 0, remaining: backup.notes.length, error: "" };
  if (backup.domain === "bible") {
    const existing = await ownBibleNotes(accountId, client, active);
    const ids = new Map(existing.map((note) => [note.id, bibleContent(note)]));
    const contents = new Set(existing.map(bibleContent));
    for (const note of backup.notes) {
      const content = bibleContent(note);
      if (ids.has(note.id) && ids.get(note.id) !== content) result.conflicts++;
      else if (contents.has(content)) result.duplicates++;
      else {
        active();
        try {
          const id = z.string().uuid().parse(newId());
          if (ids.has(id)) throw new Error("导入编号冲突，请重试");
          const { translation, bookCode, chapter, verseStart: verse } = note.source;
          const saved = await client.createBible(id, { translation, bookCode, chapter, verse }, note.text);
          if (saved.note.accountId !== accountId || bibleContent(bibleBackupNote(saved.note)) !== content || saved.note.publishedAt) throw new Error("导入结果不符，请刷新笔记后重试");
          ids.set(saved.note.id, content);
          contents.add(content);
          result.imported++;
        } catch (error) { result.error = error instanceof Error ? error.message : "笔记导入失败"; return result; }
      }
      result.remaining--;
    }
    return result;
  }
  const books = await bookCatalog(client, active);
  const inventories = new Map<number, { ids: Map<string, string>; contents: Set<string> }>();
  // Read every affected book before writing, so inventory failures cannot cause blind updates.
  for (const note of backup.notes) {
    const book = bookForNote(note, books);
    if (!book || inventories.has(book.id)) continue;
    active();
    const { notes } = await client.listBookNotes(book.id);
    active();
    assertCount(notes.length);
    const own = notes.map((item) => bookBackupNote(item, book));
    inventories.set(book.id, { ids: new Map(own.map((item) => [item.id, bookContent(item)])), contents: new Set(own.map(bookContent)) });
  }
  for (const note of backup.notes) {
    const book = bookForNote(note, books);
    if (!book) result.unavailable++;
    else {
      const inventory = inventories.get(book.id)!;
      const content = bookContent(note);
      if (inventory.ids.has(note.id) && inventory.ids.get(note.id) !== content) result.conflicts++;
      else if (inventory.contents.has(content)) result.duplicates++;
      else {
        active();
        try {
          const id = z.string().uuid().parse(newId());
          if (inventory.ids.has(id)) throw new Error("导入编号冲突，请重试");
          const input = { quote: note.quote, text: note.text, chapter: note.chapter, fraction: note.fraction };
          const saved = await client.createBook(book.id, id, input);
          if (bookContent(bookBackupNote(saved.note, book)) !== content) throw new Error("导入结果不符，请刷新笔记后重试");
          inventory.ids.set(saved.note.id, content);
          inventory.contents.add(content);
          result.imported++;
        } catch (error) { result.error = error instanceof Error ? error.message : "笔记导入失败"; return result; }
      }
    }
    result.remaining--;
  }
  return result;
}
