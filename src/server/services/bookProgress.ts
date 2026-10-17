import { Prisma, type PrismaClient, type BookProgress } from "@prisma/client";
import { bookLocatorSchema, type BookProgressSnapshot, type BookProgressWrite } from "../../shared/bookLocator.js";

type Publication = { id: number; publicationRevision: string | null };
export function bookProgressSnapshot(book: Publication, row: BookProgress | null): BookProgressSnapshot {
  const parsed = bookLocatorSchema.safeParse(row?.locator);
  const locator = parsed.success && row?.locatorRevision === row?.revision
    && parsed.data.bookId === book.id && parsed.data.publicationRevision === book.publicationRevision ? parsed.data : null;
  return { bookId: book.id, publicationRevision: book.publicationRevision, fraction: row?.fraction ?? null,
    revision: row?.revision ?? 0, locatorRevision: locator ? row!.revision : null, locator };
}

export function createBookProgressService(prisma: Pick<PrismaClient, "bookProgress" | "$transaction">) {
  const read = async (accountId: number, book: Publication) => bookProgressSnapshot(book,
    await prisma.bookProgress.findUnique({ where: { bookId_accountId: { bookId: book.id, accountId } } }));
  async function write(accountId: number, book: Publication, input: BookProgressWrite) {
    if (input.locator && (input.locator.bookId !== book.id || input.locator.publicationRevision !== book.publicationRevision)) {
      throw Object.assign(new Error("图书版本不一致，请重新打开后保存"), { statusCode: 422 });
    }
    const where = { bookId: book.id, accountId };
    try {
      return await prisma.$transaction(async tx => {
        const previous = await tx.bookProgress.findUnique({ where: { bookId_accountId: where } });
        if (previous?.lastMutationId === input.mutationId) return { conflict: false, progress: bookProgressSnapshot(book, previous) };
        if ((previous?.revision ?? 0) !== input.baseRevision) return { conflict: true, progress: bookProgressSnapshot(book, previous) };
        const revision = input.baseRevision + 1;
        const data = { fraction: input.fraction, locator: input.locator ?? Prisma.DbNull,
          revision, locatorRevision: input.locator ? revision : null, lastMutationId: input.mutationId };
        if (!previous) {
          const saved = await tx.bookProgress.create({ data: { ...where, ...data } });
          return { conflict: false, progress: bookProgressSnapshot(book, saved) };
        }
        const updated = await tx.bookProgress.updateMany({ where: { ...where, revision: input.baseRevision }, data });
        // The CAS loses to v1 or another device even if our earlier read succeeded.
        if (!updated.count) return { conflict: true, progress: await read(accountId, book) };
        return { conflict: false, progress: { bookId: book.id, publicationRevision: book.publicationRevision,
          fraction: input.fraction, locator: input.locator, revision, locatorRevision: input.locator ? revision : null } };
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !["P2002", "P2034"].includes(error.code)) throw error;
      return { conflict: true, progress: await read(accountId, book) };
    }
  }
  return { read, write };
}
