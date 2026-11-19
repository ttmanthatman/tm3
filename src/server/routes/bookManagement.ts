import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { bookDto, type BooksRouteDeps } from "./books.js";

// Lifecycle changes retain the book identity, files, notes and every account's progress.
export function registerBookManagementRoutes(app: FastifyInstance, deps: BooksRouteDeps) {
  const { prisma, requireAdmin } = deps;
  const options = { preHandler: [requireAdmin] };
  const paramsSchema = z.object({ id: z.coerce.number().int().positive().max(2147483647) });
  const actionSchema = z.object({ action: z.enum(["publish", "unpublish", "restore"]) }).strict();

  app.get("/api/admin/books", options, async (_request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const books = await prisma.book.findMany({ orderBy: { createdAt: "desc" } });
    return { success: true, books: books.map(book => ({
      ...bookDto({ ...book, progress: [] }),
      isPublished: book.isPublished,
      deletedAt: book.deletedAt?.toISOString() ?? null
    })) };
  });

  app.patch("/api/admin/books/:id", options, async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const body = actionSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ success: false, message: "无效的图书操作" });
    const { action } = body.data;
    // Conditional updates prevent stale publish requests from reviving trashed books.
    const result = await prisma.book.updateMany({
      where: { id: params.data.id, deletedAt: action === "restore" ? { not: null } : null },
      data: action === "restore" ? { deletedAt: null, isPublished: false } : { isPublished: action === "publish" }
    });
    if (!result.count) return reply.code(409).send({ success: false, message: "图书状态已变化或图书不存在，请刷新后重试" });
    return { success: true };
  });

  app.delete("/api/admin/books/:id", options, async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ success: false, message: "无效的图书 ID" });
    const result = await prisma.book.updateMany({
      where: { id: params.data.id },
      data: { deletedAt: new Date(), isPublished: false }
    });
    if (!result.count) return reply.code(404).send({ success: false, message: "图书不存在" });
    return { success: true };
  });
}
