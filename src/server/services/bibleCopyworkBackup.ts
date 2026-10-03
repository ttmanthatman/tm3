import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  COPYWORK_MAX_BYTES,
  COPYWORK_MAX_CHARACTERS,
  COPYWORK_MAX_POINTS,
  copyworkCharacters,
  copyworkPayload,
  normalizeCopyworkGlyph
} from "../../shared/bibleCopywork.js";
import { copyworkSource } from "./bibleCopyworks.js";
const record = z.object({
  id: z.string().uuid(),
  accountId: z.number().int().positive(),
  spacing: z.enum(["compact", "normal", "loose"]),
  translation: z.string().max(30),
  bookCode: z.string().length(3),
  chapter: z.number().int().positive(),
  verseStart: z.number().int().positive(),
  verseEnd: z.number().int().positive(),
  source: z.object({ text: z.string().max(4000) }).passthrough(),
  completedAt: z.coerce.date(),
  publishedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  glyphs: z
    .array(z.object({ position: z.number().int().nonnegative(), ink: z.unknown() }))
    .max(COPYWORK_MAX_CHARACTERS),
  shares: z.array(z.object({ messageId: z.number().int().positive() })).default([])
});
export function parseCopyworkBackup(value: unknown) {
  return z
    .array(record)
    .parse(value)
    .map((row) => {
      const source = { ...copyworkSource(row), text: row.source.text };
      const glyphs = [...row.glyphs]
        .sort((a, b) => a.position - b.position)
        .map((g) => ({ position: g.position, ink: normalizeCopyworkGlyph(g.ink) }));
      if (
        glyphs.length !== copyworkCharacters(source.text).length ||
        glyphs.some((g, i) => g.position !== i)
      )
        throw new Error("抄写备份字符不完整");
      if (
        Buffer.byteLength(JSON.stringify(glyphs)) > COPYWORK_MAX_BYTES ||
        glyphs.reduce(
          (n, g) => n + g.ink.character.strokes.reduce((p, s) => p + s.points.length, 0),
          0
        ) > COPYWORK_MAX_POINTS
      )
        throw new Error("抄写备份超过容量");
      return { ...row, source: { ...source, bounds: glyphs.map((g) => g.ink.bounds) }, glyphs };
    });
}
export async function importCopyworkBackup(
  tx: Prisma.TransactionClient,
  rows: ReturnType<typeof parseCopyworkBackup>
) {
  for (const row of rows) {
    const { glyphs, shares, source, ...metadata } = row;
    const data = { ...metadata, source: source as unknown as Prisma.InputJsonValue };
    await tx.bibleCopywork.upsert({ where: { id: row.id }, create: data, update: data });
    await tx.bibleCopyworkGlyph.deleteMany({ where: { workId: row.id } });
    await tx.bibleCopyworkGlyph.createMany({
      data: glyphs.map((g) => ({
        workId: row.id,
        position: g.position,
        ink: g.ink as unknown as Prisma.InputJsonValue
      }))
    });
    await tx.bibleCopyworkShare.deleteMany({ where: { workId: row.id } });
    for (const share of shares) {
      const message = await tx.message.findUnique({
        where: { id: share.messageId },
        include: { sender: { select: { accountId: true } } }
      });
      if (
        !message ||
        message.type !== "bible_copywork" ||
        copyworkPayload(message.payload)?.workId !== row.id ||
        message.sender.accountId !== row.accountId
      )
        throw new Error("抄写分享关联无效");
      await tx.bibleCopyworkShare.create({ data: { workId: row.id, messageId: share.messageId } });
    }
  }
}
