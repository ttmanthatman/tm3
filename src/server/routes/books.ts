// 图书室路由：书架列表 / 图书文件下发（Range + 长缓存）/ 阅读进度 / 管理员上传与删除。
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { BookDTO } from "../../shared/types.js";
import { BOOK_UPLOAD_MAX_BYTES, EpubRejectedError, readEpubMeta } from "../books/epub.js";

export type BooksAuth = {
  accountId: number;
  isAdmin: boolean;
};

export type BooksRouteDeps = {
  prisma: PrismaClient;
  booksDir: string;
  requireAuth: preHandlerHookHandler;
  requireMediaAuth: preHandlerHookHandler;
  requireAdmin: preHandlerHookHandler;
  authFor: (request: FastifyRequest) => BooksAuth;
  imageWebpEffort: number;
};

const bookFileNameRe = /^[a-f0-9-]{36}\.epub$/;
const coverFileNameRe = /^[a-f0-9-]{36}\.webp$/;

const progressSchema = z.object({
  fraction: z.number().min(0).max(1)
});

function bookDto(book: {
  id: number;
  title: string;
  author: string;
  language: string;
  fileName: string;
  coverName: string | null;
  fileSize: number;
  createdAt: Date;
  progress: { fraction: number }[];
}): BookDTO {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    language: book.language,
    fileName: book.fileName,
    coverName: book.coverName,
    fileSize: book.fileSize,
    createdAt: book.createdAt.toISOString(),
    progress: book.progress[0]?.fraction ?? null
  };
}

function applyBookFileHeaders(reply: FastifyReply, fileName: string, stat: fs.Stats) {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Cross-Origin-Resource-Policy", "same-origin");
  reply.header("Content-Type", fileName.endsWith(".webp") ? "image/webp" : "application/epub+zip");
  // 文件名按上传内容生成（UUID），同一 URL 内容不变，可长缓存；
  // 管理员重新上传会生成新文件名，客户端拿到的 URL 随之变化，自动实现“有新版才更新缓存”。
  reply.header("Cache-Control", "private, max-age=31536000, immutable");
  reply.header("ETag", `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`);
  reply.header("Accept-Ranges", "bytes");
}

function sendBookFile(request: FastifyRequest, reply: FastifyReply, filePath: string, fileName: string) {
  const stat = fs.statSync(filePath);
  applyBookFileHeaders(reply, fileName, stat);
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  if (String(request.headers["if-none-match"] || "") === etag) return reply.code(304).send();

  const range = String(request.headers.range || "");
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (range && match) {
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
    if (Number.isFinite(start) && Number.isFinite(end) && start <= end && start < stat.size) {
      reply.code(206);
      reply.header("Content-Range", `bytes ${start}-${end}/${stat.size}`);
      reply.header("Content-Length", end - start + 1);
      return reply.send(fs.createReadStream(filePath, { start, end }));
    }
    reply.code(416);
    reply.header("Content-Range", `bytes */${stat.size}`);
    return reply.send();
  }
  reply.header("Content-Length", stat.size);
  return reply.send(fs.createReadStream(filePath));
}

async function extractCover(zipEntryFile: { async(format: "nodebuffer"): Promise<Buffer> }, targetPath: string, effort: number) {
  const { default: sharp } = await import("sharp");
  await sharp(await zipEntryFile.async("nodebuffer"))
    .rotate()
    .resize(480, 720, { fit: "inside", withoutEnlargement: true })
    .webp({ effort })
    .toFile(targetPath);
}

// EPUB 未带封面时，按书名/作者生成一张与书架风格一致的封面，保证书单视觉统一。
async function renderGeneratedCover(title: string, author: string, targetPath: string): Promise<void> {
  const { default: sharp } = await import("sharp");
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const shortTitle = title.slice(0, 40);
  const shortAuthor = author.slice(0, 24);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
  <defs>
    <linearGradient id="spine" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#e8ddc9"/>
      <stop offset="0.05" stop-color="#f4ecdc"/>
      <stop offset="1" stop-color="#faf5ea"/>
    </linearGradient>
  </defs>
  <rect width="600" height="800" fill="url(#spine)"/>
  <rect x="30" y="30" width="540" height="740" fill="none" stroke="#c9b896" stroke-width="2"/>
  <text x="300" y="330" text-anchor="middle" font-family="Songti SC, STSong, serif" font-size="${shortTitle.length > 14 ? 40 : 52}" font-weight="700" fill="#5d4a33">${escape(shortTitle)}</text>
  <line x1="220" y1="380" x2="380" y2="380" stroke="#b39a72" stroke-width="2"/>
  ${shortAuthor ? `<text x="300" y="430" text-anchor="middle" font-family="Songti SC, STSong, serif" font-size="28" fill="#8a7557">${escape(shortAuthor)}</text>` : ""}
</svg>`;
  await sharp(Buffer.from(svg)).webp({ quality: 88 }).toFile(targetPath);
}

export function registerBooksRoutes(app: FastifyInstance, deps: BooksRouteDeps) {
  const { prisma, booksDir, requireAuth, requireMediaAuth, requireAdmin, authFor } = deps;

  fs.mkdirSync(booksDir, { recursive: true });

  app.get("/api/books", { preHandler: [requireAuth] }, async (request) => {
    const auth = authFor(request);
    const books = await prisma.book.findMany({
      orderBy: { createdAt: "desc" },
      include: { progress: { where: { accountId: auth.accountId }, select: { fraction: true } } }
    });
    return { success: true, books: books.map(bookDto) };
  });

  app.post("/api/admin/books", { preHandler: [requireAdmin] }, async (request, reply) => {
    const part = await request.file({ limits: { fileSize: BOOK_UPLOAD_MAX_BYTES, files: 1 } });
    if (!part) return reply.code(400).send({ success: false, message: "请选择要上传的 EPUB 文件" });
    const original = part.filename || "";
    if (!original.toLowerCase().endsWith(".epub")) {
      await part.toBuffer().catch(() => Buffer.alloc(0));
      return reply.code(400).send({ success: false, message: "只支持 .epub 文件" });
    }
    let buffer: Buffer;
    try {
      buffer = await part.toBuffer();
    } catch {
      return reply.code(413).send({ success: false, message: "图书文件超过 60MB 上限" });
    }

    let meta;
    let zip;
    try {
      ({ meta, zip } = await readEpubMeta(buffer));
    } catch (error) {
      const message = error instanceof EpubRejectedError ? error.message : "EPUB 解析失败";
      return reply.code(400).send({ success: false, message });
    }

    const fileName = `${crypto.randomUUID()}.epub`;
    const filePath = path.join(booksDir, fileName);
    fs.writeFileSync(filePath, buffer);

    let coverName: string | null = null;
    if (meta.coverEntry) {
      try {
        const coverFileName = `${crypto.randomUUID()}.webp`;
        await extractCover(zip.file(meta.coverEntry)!, path.join(booksDir, coverFileName), deps.imageWebpEffort);
        coverName = coverFileName;
      } catch {
        coverName = null; // 封面提取失败不阻断导入
      }
    }
    if (!coverName) {
      // EPUB 未带封面：生成书名封面，保证书架每本书都有封面
      try {
        const coverFileName = `${crypto.randomUUID()}.webp`;
        await renderGeneratedCover(meta.title, meta.author, path.join(booksDir, coverFileName));
        coverName = coverFileName;
      } catch {
        coverName = null;
      }
    }

    const auth = authFor(request);
    const book = await prisma.book.create({
      data: {
        title: meta.title.slice(0, 200),
        author: meta.author.slice(0, 120),
        language: meta.language.slice(0, 20),
        fileName,
        coverName,
        fileSize: buffer.length,
        createdById: auth.accountId
      },
      include: { progress: { where: { accountId: auth.accountId }, select: { fraction: true } } }
    });
    return reply.code(201).send({ success: true, book: bookDto(book) });
  });

  app.delete("/api/admin/books/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ success: false, message: "无效的图书 ID" });
    const book = await prisma.book.findUnique({ where: { id: params.data.id } });
    if (!book) return reply.code(404).send({ success: false, message: "图书不存在" });

    await prisma.book.delete({ where: { id: book.id } });
    for (const name of [book.fileName, book.coverName]) {
      if (!name) continue;
      if (!(bookFileNameRe.test(name) || coverFileNameRe.test(name))) continue;
      fs.promises.unlink(path.join(booksDir, name)).catch(() => {});
    }
    return { success: true };
  });

  app.get("/api/books/:id/file", { preHandler: [requireMediaAuth] }, async (request, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ success: false, message: "无效的图书 ID" });
    const book = await prisma.book.findUnique({ where: { id: params.data.id }, select: { fileName: true } });
    if (!book || !bookFileNameRe.test(book.fileName)) return reply.code(404).send({ success: false, message: "图书不存在" });
    const filePath = path.join(booksDir, book.fileName);
    if (!fs.existsSync(filePath)) return reply.code(404).send({ success: false, message: "图书文件缺失" });
    return sendBookFile(request, reply, filePath, book.fileName);
  });

  app.get("/api/books/:id/cover", { preHandler: [requireMediaAuth] }, async (request, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ success: false, message: "无效的图书 ID" });
    const book = await prisma.book.findUnique({ where: { id: params.data.id }, select: { coverName: true } });
    if (!book?.coverName || !coverFileNameRe.test(book.coverName)) {
      return reply.code(404).send({ success: false, message: "没有封面" });
    }
    const filePath = path.join(booksDir, book.coverName);
    if (!fs.existsSync(filePath)) return reply.code(404).send({ success: false, message: "封面文件缺失" });
    return sendBookFile(request, reply, filePath, book.coverName);
  });

  app.put("/api/books/:id/progress", { preHandler: [requireAuth] }, async (request, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(request.params);
    const body = progressSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ success: false, message: "无效的进度数据" });
    const book = await prisma.book.findUnique({ where: { id: params.data.id }, select: { id: true } });
    if (!book) return reply.code(404).send({ success: false, message: "图书不存在" });
    const auth = authFor(request);
    await prisma.bookProgress.upsert({
      where: { bookId_accountId: { bookId: book.id, accountId: auth.accountId } },
      create: { bookId: book.id, accountId: auth.accountId, fraction: body.data.fraction },
      update: { fraction: body.data.fraction }
    });
    return { success: true };
  });
}
