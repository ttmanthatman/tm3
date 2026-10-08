import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { BIBLE_NOTE_TEXT_MAX, bibleNotePayload } from "../../shared/bibleNotes.js";
import { bibleNoteSource } from "./bibleNotes.js";

const savedDate = z.union([z.string(), z.date()]).pipe(z.coerce.date());
const record = z.object({
  id: z.string().uuid(),
  accountId: z.number().int().positive(),
  translation: z.string().max(30),
  bookCode: z.string().length(3),
  chapter: z.number().int().positive(),
  verse: z.number().int().positive(),
  source: z.object({ text: z.string().min(1).max(4000) }).passthrough(),
  text: z
    .string()
    .max(BIBLE_NOTE_TEXT_MAX)
    .refine((text) => text.trim().length > 0, "笔记内容不能为空"),
  publishedAt: savedDate.nullable(),
  createdAt: savedDate,
  updatedAt: savedDate,
  shares: z.array(z.object({ messageId: z.number().int().positive() })).default([])
});

export function parseBibleNoteBackup(value: unknown) {
  return z
    .array(record)
    .parse(value)
    .map((row) => ({
      ...row,
      source: { ...bibleNoteSource(row), text: row.source.text }
    }));
}

export async function importBibleNoteBackup(
  tx: Prisma.TransactionClient,
  rows: ReturnType<typeof parseBibleNoteBackup>
) {
  for (const row of rows) {
    const { shares, source, ...metadata } = row;
    const data = { ...metadata, source: source as unknown as Prisma.InputJsonValue };
    await tx.bibleNote.upsert({ where: { id: row.id }, create: data, update: data });
    await tx.bibleNoteShare.deleteMany({ where: { noteId: row.id } });
    for (const share of shares) {
      const message = await tx.message.findUnique({
        where: { id: share.messageId },
        include: { sender: { select: { accountId: true } } }
      });
      if (
        !message ||
        message.type !== "bible_note" ||
        bibleNotePayload(message.payload)?.noteId !== row.id ||
        message.sender.accountId !== row.accountId
      )
        throw new Error("笔记分享关联无效");
      await tx.bibleNoteShare.create({ data: { noteId: row.id, messageId: share.messageId } });
    }
  }
}
