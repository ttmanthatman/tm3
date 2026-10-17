import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";

/** Bounded maintenance, never part of a read/open request. EPUB bytes are read only. */
export async function backfillBookRevisions(prisma: Pick<PrismaClient, "book">, booksDir: string, limit = 100) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("Revision batch limit must be between 1 and 1000");
  const books = await prisma.book.findMany({ where: { publicationRevision: null }, orderBy: { id: "asc" }, take: limit,
    select: { id: true, fileName: true, fileSize: true } });
  let updated = 0;
  const failed: number[] = [];
  for (const book of books) {
    try {
      if (!/^[a-f0-9-]{36}\.epub$/.test(book.fileName)) throw new Error("Invalid stored book filename");
      const filename = path.join(booksDir, book.fileName), before = await fs.promises.stat(filename);
      if (before.size !== book.fileSize || !before.isFile()) throw new Error("Book bytes changed");
      const hash = crypto.createHash("sha256");
      for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
      const after = await fs.promises.stat(filename);
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ino !== before.ino) throw new Error("Book bytes changed during hashing");
      updated += (await prisma.book.updateMany({ where: { id: book.id, fileName: book.fileName, fileSize: book.fileSize, publicationRevision: null },
        data: { publicationRevision: hash.digest("hex") } })).count;
    } catch { failed.push(book.id); }
  }
  return { examined: books.length, updated, failed };
}
