/// <reference types="node" />

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import Fastify, { type FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import JSZip from "jszip";
import { EpubRejectedError, readEpubMeta } from "../books/epub.js";
import { registerBooksRoutes } from "./books.js";

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

const OPF = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:test:1</dc:identifier>
    <dc:title>测试图书</dc:title>
    <dc:creator>测试作者</dc:creator>
    <dc:language>zh</dc:language>
    <meta name="cover" content="cvr"/>
  </metadata>
  <manifest>
    <item id="cvr" href="cover.png" media-type="image/png"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`;

// 1x1 PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

async function buildEpub(overrides: { opf?: string; extra?: Record<string, Buffer | string> } = {}) {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", CONTAINER);
  zip.file("OEBPS/content.opf", overrides.opf ?? OPF);
  zip.file("OEBPS/ch1.xhtml", "<html><body><p>hello</p></body></html>");
  zip.file("OEBPS/cover.png", PNG);
  for (const [name, data] of Object.entries(overrides.extra ?? {})) zip.file(name, data);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

type BookRow = {
  id: number;
  title: string;
  author: string;
  language: string;
  fileName: string;
  coverName: string | null;
  fileSize: number;
  createdAt: Date;
  createdById: number | null;
  progress: { fraction: number }[];
};

async function createHarness(options: { admin?: boolean } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "books-test-"));
  const rows = new Map<number, BookRow>();
  let nextId = 1;
  const prisma = {
    book: {
      findMany: async () => [...rows.values()],
      findUnique: async ({ where }: { where: { id?: number } }) => rows.get(where.id ?? -1) ?? null,
      create: async ({ data, include }: { data: Record<string, unknown>; include?: unknown }) => {
        const row: BookRow = {
          id: nextId++,
          title: String(data.title),
          author: String(data.author),
          language: String(data.language),
          fileName: String(data.fileName),
          coverName: (data.coverName as string | null) ?? null,
          fileSize: Number(data.fileSize),
          createdAt: new Date(),
          createdById: (data.createdById as number | null) ?? null,
          progress: []
        };
        rows.set(row.id, row);
        return row;
      },
      delete: async ({ where }: { where: { id: number } }) => {
        rows.delete(where.id);
      }
    },
    bookProgress: {
      upsert: async ({ create }: { create: { bookId: number; accountId: number; fraction: number } }) => {
        const row = rows.get(create.bookId);
        row?.progress.splice(0, row.progress.length, { fraction: create.fraction });
      }
    }
  };
  const app = Fastify();
  await app.register(multipart, { limits: { fileSize: 80 * 1024 * 1024, files: 1 } });
  const requireAuth = async (_request: FastifyRequest, reply: { sent: boolean; code: (n: number) => { send: (b: unknown) => unknown } }) => {
    if (!options.admin && options.admin !== undefined) reply.code(401).send({ success: false });
  };
  const requireAdmin = async (_request: FastifyRequest, reply: { sent: boolean; code: (n: number) => { send: (b: unknown) => unknown } }) => {
    if (options.admin !== true) reply.code(403).send({ success: false, message: "需要管理员权限" });
  };
  registerBooksRoutes(app, {
    prisma: prisma as unknown as PrismaClient,
    booksDir: dir,
    requireAuth: requireAuth as never,
    requireMediaAuth: requireAuth as never,
    requireAdmin: requireAdmin as never,
    authFor: () => ({ accountId: 7, isAdmin: options.admin === true }),
    imageWebpEffort: 0
  });
  return { app, dir, rows };
}

async function upload(app: Fastify.FastifyInstance, filename: string, data: Buffer) {
  const boundary = "----testboundary";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/epub+zip\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return app.inject({
    method: "POST",
    url: "/api/admin/books",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([head, data, tail])
  });
}

test("readEpubMeta extracts title/author/language/cover from a valid epub", async () => {
  const { meta } = await readEpubMeta(await buildEpub());
  assert.equal(meta.title, "测试图书");
  assert.equal(meta.author, "测试作者");
  assert.equal(meta.language, "zh");
  assert.equal(meta.coverEntry, "OEBPS/cover.png");
});

test("readEpubMeta decodes XML entities in titles", async () => {
  const opf = OPF.replace("<dc:title>测试图书</dc:title>", "<dc:title>A &amp; B &#23665;</dc:title>");
  const { meta } = await readEpubMeta(await buildEpub({ opf }));
  assert.equal(meta.title, "A & B 山");
});

test("readEpubMeta rejects non-zip input", async () => {
  await assert.rejects(() => readEpubMeta(Buffer.from("not a zip")), EpubRejectedError);
});

test("readEpubMeta rejects wrong mimetype declaration", async () => {
  const zip = new JSZip();
  zip.file("mimetype", "text/plain");
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  await assert.rejects(() => readEpubMeta(buffer), /mimetype/);
});

test("readEpubMeta rejects Adobe DRM", async () => {
  const buffer = await buildEpub({
    extra: {
      "META-INF/encryption.xml":
        '<encryption><enc:encryptedKey xmlns:enc="http://ns.adobe.com/adept"/></encryption>'
    }
  });
  await assert.rejects(() => readEpubMeta(buffer), /DRM/);
});

test("readEpubMeta rejects path traversal entries", async () => {
  const buffer = await buildEpub({ extra: { "../evil.txt": "x" } });
  await assert.rejects(() => readEpubMeta(buffer), /非法路径/);
});

test("admin upload creates book with metadata and cover; list includes progress", async (t) => {
  const { app, dir, rows } = await createHarness({ admin: true });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const res = await upload(app, "demo.epub", await buildEpub());
  assert.equal(res.statusCode, 201, res.body);
  const body = res.json();
  assert.equal(body.success, true);
  assert.equal(body.book.title, "测试图书");
  assert.match(body.book.fileName, /^[a-f0-9-]{36}\.epub$/);
  assert.match(body.book.coverName, /\.webp$/);

  // 文件与封面真实落盘
  assert.ok(fs.existsSync(path.join(dir, body.book.fileName)));
  assert.ok(fs.existsSync(path.join(dir, body.book.coverName)));
  assert.ok(fs.statSync(path.join(dir, body.book.coverName)).size > 0);

  const list = await app.inject({ method: "GET", url: "/api/books" });
  assert.equal(list.json().books.length, 1);
  assert.equal(list.json().books[0].progress, null);
});

test("upload rejects non-epub extension and bad content", async (t) => {
  const { app, dir } = await createHarness({ admin: true });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const badExt = await upload(app, "book.txt", await buildEpub());
  assert.equal(badExt.statusCode, 400);

  const badContent = await upload(app, "book.epub", Buffer.from("garbage"));
  assert.equal(badContent.statusCode, 400);
  assert.match(badContent.json().message, /EPUB|ZIP/);
});

test("non-admin cannot upload or delete", async (t) => {
  const { app, dir } = await createHarness({ admin: false });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const res = await upload(app, "demo.epub", await buildEpub());
  assert.equal(res.statusCode, 403);
  const del = await app.inject({ method: "DELETE", url: "/api/admin/books/1" });
  assert.equal(del.statusCode, 403);
});

test("file endpoint serves bytes with range support and immutable caching", async (t) => {
  const { app, dir } = await createHarness({ admin: true });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const epub = await buildEpub();
  const up = await upload(app, "demo.epub", epub);
  const id = up.json().book.id;

  const full = await app.inject({ method: "GET", url: `/api/books/${id}/file` });
  assert.equal(full.statusCode, 200);
  assert.equal(full.headers["cache-control"], "private, max-age=31536000, immutable");
  assert.equal(full.headers["accept-ranges"], "bytes");
  assert.equal(full.headers["content-type"], "application/epub+zip");
  assert.equal(full.rawPayload.length, epub.length);

  const ranged = await app.inject({
    method: "GET",
    url: `/api/books/${id}/file`,
    headers: { range: "bytes=0-99" }
  });
  assert.equal(ranged.statusCode, 206);
  assert.equal(ranged.rawPayload.length, 100);
  assert.match(String(ranged.headers["content-range"]), /^bytes 0-99\/\d+$/);

  const etag = String(full.headers.etag);
  const notModified = await app.inject({
    method: "GET",
    url: `/api/books/${id}/file`,
    headers: { "if-none-match": etag }
  });
  assert.equal(notModified.statusCode, 304);

  const missing = await app.inject({ method: "GET", url: "/api/books/999/file" });
  assert.equal(missing.statusCode, 404);
});

test("progress endpoint upserts per-account progress", async (t) => {
  const { app, dir } = await createHarness({ admin: true });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const up = await upload(app, "demo.epub", await buildEpub());
  const id = up.json().book.id;

  const bad = await app.inject({ method: "PUT", url: `/api/books/${id}/progress`, payload: { fraction: 2 } });
  assert.equal(bad.statusCode, 400);

  const ok = await app.inject({ method: "PUT", url: `/api/books/${id}/progress`, payload: { fraction: 0.42 } });
  assert.equal(ok.statusCode, 200);

  const list = await app.inject({ method: "GET", url: "/api/books" });
  assert.equal(list.json().books[0].progress, 0.42);
});

test("delete removes book row and files on disk", async (t) => {
  const { app, dir } = await createHarness({ admin: true });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const up = await upload(app, "demo.epub", await buildEpub());
  const book = up.json().book;

  const del = await app.inject({ method: "DELETE", url: `/api/admin/books/${book.id}` });
  assert.equal(del.statusCode, 200);
  assert.equal(fs.existsSync(path.join(dir, book.fileName)), false);
  assert.equal(fs.existsSync(path.join(dir, book.coverName)), false);

  const list = await app.inject({ method: "GET", url: "/api/books" });
  assert.equal(list.json().books.length, 0);
});
