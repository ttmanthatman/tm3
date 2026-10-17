import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { backfillBookRevisions } from "./revision.js";

test("revision maintenance reads bounded immutable files, reports missing files and CAS-protects metadata", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "epub-revision-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const name = `${crypto.randomUUID()}.epub`, bytes = Buffer.from("immutable epub fixture"), file = path.join(dir, name);
  fs.writeFileSync(file, bytes);
  const updates: unknown[] = [];
  const prisma = { book: {
    async findMany(options: { take?: number }) { assert.equal(options.take, 2); return [{ id: 1, fileName: name, fileSize: bytes.length }, { id: 2, fileName: "../../outside", fileSize: 12 }]; },
    async updateMany(options: unknown) { updates.push(options); return { count: 1 }; }
  } } as unknown as Pick<PrismaClient, "book">;
  assert.deepEqual(await backfillBookRevisions(prisma, dir, 2), { examined: 2, updated: 1, failed: [2] });
  assert.deepEqual(updates, [{ where: { id: 1, fileName: name, fileSize: bytes.length, publicationRevision: null }, data: { publicationRevision: crypto.createHash("sha256").update(bytes).digest("hex") } }]);
  assert.deepEqual(fs.readFileSync(file), bytes);
  await assert.rejects(backfillBookRevisions(prisma, dir, 0));
});
