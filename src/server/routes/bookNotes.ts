import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { bookNoteInputSchema, createBookNotesService } from "../services/bookNotes.js";
import type { BooksRouteDeps } from "./books.js";

const bookParamsSchema = z.object({ id: z.coerce.number().int().positive().max(2147483647) });
const noteParamsSchema = bookParamsSchema.extend({ noteId: z.string().uuid().transform((id) => id.toLowerCase()) });
const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

export function registerBookNotesRoutes(app: FastifyInstance, deps: Pick<BooksRouteDeps, "prisma" | "requireAuth" | "authFor">) {
  const notes = createBookNotesService(deps.prisma);
  const preHandler = [deps.requireAuth];

  async function loadBook(id: number) {
    const book = await deps.prisma.book.findUnique({ where: { id }, select: { id: true, title: true } });
    if (!book) throw fail(404, "图书不存在");
    return book;
  }

  app.get("/api/books/:id/notes", { preHandler }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const params = bookParamsSchema.safeParse(request.params);
    if (!params.success) throw fail(400, "图书编号无效");
    const book = await loadBook(params.data.id);
    return { notes: await notes.list(deps.authFor(request).accountId, book) };
  });

  app.put("/api/books/:id/notes/:noteId", { preHandler }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const params = noteParamsSchema.safeParse(request.params);
    const body = bookNoteInputSchema.safeParse(request.body);
    if (!params.success || !body.success) throw fail(400, "笔记信息无效");
    const book = await loadBook(params.data.id);
    return { note: await notes.save(deps.authFor(request).accountId, book, params.data.noteId, body.data) };
  });

  app.delete("/api/books/:id/notes/:noteId", { preHandler }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const params = noteParamsSchema.safeParse(request.params);
    if (!params.success) throw fail(400, "笔记编号无效");
    const book = await loadBook(params.data.id);
    await notes.remove(deps.authFor(request).accountId, book.id, params.data.noteId);
    return { success: true };
  });
}
