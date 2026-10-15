import { z } from "zod";
import { normalizeHandwritingPayload, type HandwritingPayload } from "./handwriting.js";

export const BOOK_QUOTE_MAX = 5000;
export const BOOK_NOTE_TEXT_MAX = 10000;
export const BOOK_NOTE_CHAPTER_MAX = 300;

export type BookNoteInput = {
  quote: string;
  text: string;
  chapter: string;
  fraction: number;
  handwriting?: HandwritingPayload | null;
  draft?: boolean;
};

export type BookNoteDTO = BookNoteInput & {
  id: string;
  bookId: number;
  bookTitle: string;
  createdAt: string;
  updatedAt: string;
};

export const bookNoteHandwritingSchema = z.unknown().transform((value, context) => {
  try { return normalizeHandwritingPayload(value); }
  catch (error) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : "手写笔记无效" });
    return z.NEVER;
  }
});
export const bookNoteInputSchema = z.object({
  quote: z.string().trim().min(1).max(BOOK_QUOTE_MAX),
  text: z.string().trim().max(BOOK_NOTE_TEXT_MAX),
  chapter: z.string().trim().max(BOOK_NOTE_CHAPTER_MAX),
  fraction: z.number().finite().min(0).max(1),
  handwriting: bookNoteHandwritingSchema.nullable().optional(),
  draft: z.boolean().optional()
}).strict();
export const bookNoteSchema = bookNoteInputSchema.extend({
  id: z.string().uuid(), bookId: z.number().int().positive().safe(), bookTitle: z.string().min(1).max(200),
  createdAt: z.string().datetime({ offset: true }), updatedAt: z.string().datetime({ offset: true })
});
export const bookNoteShareSchema = z.object({ kind: z.literal("book_note"), note: bookNoteSchema }).strict();
export type BookNoteSharePayload = z.infer<typeof bookNoteShareSchema>;
export function bookNoteSharePayload(value: unknown): BookNoteSharePayload | null {
  const parsed = bookNoteShareSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
export function bookNoteHasContent(note: Pick<BookNoteInput, "text" | "handwriting">): boolean {
  return !!note.text.trim() || !!note.handwriting?.characters.some((character) => character.strokes.some((stroke) => stroke.points.length));
}
