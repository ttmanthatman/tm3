import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { bookProgressWriteSchema } from "../../shared/bookLocator.js";
import { createBookProgressService } from "../services/bookProgress.js";
import type { BooksRouteDeps } from "./books.js";

export function registerBookProgressRoutes(app: FastifyInstance, deps: Pick<BooksRouteDeps, "prisma" | "requireAuth" | "authFor">) {
  const service = createBookProgressService(deps.prisma);
  const paramsSchema = z.object({ id: z.coerce.number().int().positive().max(2147483647) });
  const options = { preHandler: [deps.requireAuth], bodyLimit: 16 * 1024 };
  async function bookFor(params: unknown) {
    const parsed = paramsSchema.safeParse(params);
    if (!parsed.success) throw Object.assign(new Error("图书编号无效"), { statusCode: 400 });
    const book = await deps.prisma.book.findUnique({ where: { id: parsed.data.id }, select: { id: true, publicationRevision: true } });
    if (!book) throw Object.assign(new Error("图书不存在"), { statusCode: 404 });
    return book;
  }
  app.get("/api/books/:id/progress/v2", options, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    return { progress: await service.read(deps.authFor(request).accountId, await bookFor(request.params)) };
  });
  app.put("/api/books/:id/progress/v2", options, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const parsed = bookProgressWriteSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "进度地址无效" });
    const result = await service.write(deps.authFor(request).accountId, await bookFor(request.params), parsed.data);
    return reply.code(result.conflict ? 409 : 200).send(result);
  });
}
