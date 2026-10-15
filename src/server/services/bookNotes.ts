import { Prisma, type PrismaClient } from "@prisma/client";
import {
  bookNoteSchema,
  type BookNoteDTO,
  type BookNoteInput
} from "../../shared/bookNotes.js";

export { bookNoteInputSchema } from "../../shared/bookNotes.js";

// Every note has its own row, so saving one excerpt cannot overwrite another.
export function bookNotesSettingPrefix(accountId: number, bookId: number): string {
  return `book.note.${accountId}.${bookId}.`;
}

const PART_MARKER = "book-note-parts-v1";
const PART_SIZE = 12000; // At most 48 KiB per TEXT row. Preserve surrogate pairs at boundaries.
function encodeNote(note: BookNoteDTO): string[] {
  const value = JSON.stringify(note);
  if (Buffer.byteLength(value, "utf8") <= 60 * 1024) return [value];
  if (!note.handwriting) throw Object.assign(new Error("笔记内容过长，请减少文字后重试"), { statusCode: 400 });
  const parts = [];
  for (let offset = 0; offset < value.length;) {
    let end = Math.min(value.length, offset + PART_SIZE);
    if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1])) end--;
    parts.push(value.slice(offset, end)); offset = end;
  }
  return [JSON.stringify({ format: PART_MARKER, parts: parts.length }), ...parts];
}
function partCount(value: string): number {
  const parsed = JSON.parse(value);
  if (parsed.format !== PART_MARKER) return 0;
  if (!Number.isInteger(parsed.parts) || parsed.parts < 1 || parsed.parts > 200) throw new Error("Stored book note parts are invalid");
  return parsed.parts;
}
function decodeNote(value: string, key: string, prefix: string, book: { id: number; title: string }, rows: Map<string, string> = new Map()): BookNoteDTO {
  const count = partCount(value);
  const serialized = count ? Array.from({ length: count }, (_, index) => {
    const part = rows.get(`${key}.part.${index}`);
    if (part === undefined) throw new Error("Stored book note is incomplete");
    return part;
  }).join("") : value;
  const parsed = bookNoteSchema.safeParse(JSON.parse(serialized));
  if (!parsed.success || parsed.data.bookId !== book.id || `${prefix}${parsed.data.id}` !== key) throw new Error("Stored book note is invalid");
  return { ...parsed.data, bookTitle: book.title };
}

export function createBookNotesService(prisma: Pick<PrismaClient, "setting" | "$transaction">) {
  async function saveNote(accountId: number, book: { id: number; title: string }, id: string, input: BookNoteInput) {
    const prefix = bookNotesSettingPrefix(accountId, book.id), key = `${prefix}${id}`;
    const now = new Date().toISOString();
    const fresh: BookNoteDTO = { ...input, id, bookId: book.id, bookTitle: book.title, createdAt: now, updatedAt: now };
    encodeNote(fresh); // Check capacity before acquiring the row.
    const persist = () => prisma.$transaction(async (tx) => {
      // Upsert acquires the note row lock before reading/replacing its parts.
      const row = await tx.setting.upsert({ where: { key }, create: { key, value: JSON.stringify({ ...fresh, text: "", handwriting: null }) }, update: { key } });
      const parts = await tx.setting.findMany({ where: { key: { startsWith: `${key}.part.` } }, select: { key: true, value: true } });
      const previous = decodeNote(row.value, key, prefix, book, new Map(parts.map((part) => [part.key, part.value])));
      const note = { ...fresh, createdAt: previous.createdAt };
      const encoded = encodeNote(note);
      await tx.setting.deleteMany({ where: { key: { startsWith: `${key}.part.` } } });
      if (encoded.length > 1) await tx.setting.createMany({ data: encoded.slice(1).map((value, index) => ({ key: `${key}.part.${index}`, value })) });
      await tx.setting.update({ where: { key }, data: { value: encoded[0] } });
      return note;
    });
    // MySQL may race on the first upsert or abort a contended transaction.
    // Retry the complete atomic write; keep the UUID and createdAt stable.
    for (let attempt = 0; ; attempt++) {
      try { return await persist(); }
      catch (error) {
        if (attempt >= 2 || !(error instanceof Prisma.PrismaClientKnownRequestError) || !["P2002", "P2034"].includes(error.code)) throw error;
      }
    }
  }
  return {
    async list(accountId: number, book: { id: number; title: string }): Promise<BookNoteDTO[]> {
      const prefix = bookNotesSettingPrefix(accountId, book.id);
      const rows = await prisma.setting.findMany({
        where: { key: { startsWith: prefix } },
        select: { key: true, value: true }
      });
      const values = new Map(rows.map((row) => [row.key, row.value]));
      return rows.filter((row) => !row.key.slice(prefix.length).includes(".")).map((row) => decodeNote(row.value, row.key, prefix, book, values))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id));
    },

    save: saveNote,

    async remove(accountId: number, bookId: number, id: string): Promise<void> {
      const key = `${bookNotesSettingPrefix(accountId, bookId)}${id}`;
      await prisma.setting.deleteMany({ where: { OR: [{ key }, { key: { startsWith: `${key}.part.` } }] } });
    }
  };
}
