import { PrismaClient } from "@prisma/client";
import path from "node:path";
import { backfillBookRevisions } from "../server/books/revision.js";

// Explicit opt-in; read existing configuration without copying secrets into logs.
if (!process.argv.includes("--apply") || !process.env.DATABASE_URL || !process.env.STORAGE_ROOT) {
  throw new Error("Set DATABASE_URL and STORAGE_ROOT, then pass --apply [--limit=N] after reviewing the target environment");
}
const limit = Number(process.argv.find(value => value.startsWith("--limit="))?.slice(8) ?? 100);
const prisma = new PrismaClient();
try {
  const result = await backfillBookRevisions(prisma, path.join(process.env.STORAGE_ROOT, "books"), limit);
  console.log(JSON.stringify(result));
  if (result.failed.length) process.exitCode = 1;
} finally { await prisma.$disconnect(); }
