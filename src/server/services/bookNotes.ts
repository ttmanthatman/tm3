import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  BOOK_NOTE_CHAPTER_MAX,
  BOOK_NOTE_TEXT_MAX,
  BOOK_QUOTE_MAX,
  type BookNoteDTO,
  type BookNoteInput
} from "../../shared/bookNotes.js";

export const bookNoteInputSchema = z.object({
  quote: z.string().trim().min(1).max(BOOK_QUOTE_MAX),
  text: z.string().trim().max(BOOK_NOTE_TEXT_MAX),
  chapter: z.string().trim().max(BOOK_NOTE_CHAPTER_MAX),
  fraction: z.number().finite().min(0).max(1)
}).strict();

const storedNoteSchema = bookNoteInputSchema.extend({
  id: z.string().uuid(),
  bookId: z.number().int().positive().safe(),
  bookTitle: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

// Every note has its own row, so saving one excerpt cannot overwrite another.
export function bookNotesSettingPrefix(accountId: number, bookId: number): string {
  return `book.note.${accountId}.${bookId}.`;
}

function encodeNote(note: BookNoteDTO): string {
  const value = JSON.stringify(note);
  // Setting.value is MySQL TEXT: escaped characters must also fit its byte limit.
  if (Buffer.byteLength(value, "utf8") > 60 * 1024) {
    throw Object.assign(new Error("笔记内容过长，请减少文字后重试"), { statusCode: 400 });
  }
  return value;
}

function decodeNote(value: string, key: string, prefix: string, book: { id: number; title: string }): BookNoteDTO {
  const parsed = storedNoteSchema.safeParse(JSON.parse(value));
  if (!parsed.success || parsed.data.bookId !== book.id || `${prefix}${parsed.data.id}` !== key) {
    throw new Error("Stored book note is invalid");
  }
  return { ...parsed.data, bookTitle: book.title };
}

export function createBookNotesService(prisma: Pick<PrismaClient, "setting">) {
  return {
    async list(accountId: number, book: { id: number; title: string }): Promise<BookNoteDTO[]> {
      const prefix = bookNotesSettingPrefix(accountId, book.id);
      const rows = await prisma.setting.findMany({
        where: { key: { startsWith: prefix } },
        select: { key: true, value: true }
      });
      return rows.map((row) => decodeNote(row.value, row.key, prefix, book))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id));
    },

    async save(accountId: number, book: { id: number; title: string }, id: string, input: BookNoteInput): Promise<BookNoteDTO> {
      const prefix = bookNotesSettingPrefix(accountId, book.id);
      const key = `${prefix}${id}`;
      const now = new Date().toISOString();
      const fresh: BookNoteDTO = { ...input, id, bookId: book.id, bookTitle: book.title, createdAt: now, updatedAt: now };
      const value = encodeNote(fresh);
      let existing = await prisma.setting.findUnique({ where: { key }, select: { value: true } });
      if (!existing) {
        try {
          await prisma.setting.create({ data: { key, value } });
          return fresh;
        } catch (error) {
          // Concurrent devices can create the same retry UUID. The winning row
          // owns createdAt; later writes must preserve it rather than recreate it.
          if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
          existing = await prisma.setting.findUnique({ where: { key }, select: { value: true } });
          if (!existing) throw error;
        }
      }
      const previous = decodeNote(existing.value, key, prefix, book);
      const note = { ...fresh, createdAt: previous.createdAt, updatedAt: new Date().toISOString() };
      await prisma.setting.update({ where: { key }, data: { value: encodeNote(note) } });
      return note;
    },

    async remove(accountId: number, bookId: number, id: string): Promise<void> {
      await prisma.setting.deleteMany({ where: { key: `${bookNotesSettingPrefix(accountId, bookId)}${id}` } });
    }
  };
}
