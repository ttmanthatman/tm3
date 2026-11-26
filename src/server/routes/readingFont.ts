import fs from "node:fs";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { READING_FONT_MAX_BYTES, READING_FONT_SETTING } from "../../shared/readingFont.js";
import { createReadingFontStorage, validateReadingFont } from "../services/readingFont.js";
import type { AppearanceService } from "./appearance.js";

export function registerReadingFontRoutes(app: FastifyInstance, deps: {
  requireAdmin: preHandlerHookHandler;
  appearance: AppearanceService;
  directory: string;
  io: { emit(event: string, payload: unknown): unknown };
}) {
  const storage = createReadingFontStorage(deps.directory);
  // Serialize replacements so each mutation can retire its previous file.
  let mutations = Promise.resolve();
  function mutate(operation: () => Promise<unknown>) {
    const pending = mutations.then(operation);
    mutations = pending.then(() => undefined, () => undefined);
    return pending;
  }
  async function publish() {
    const appearance = await deps.appearance.appearanceDto();
    deps.io.emit("appearance:updated", appearance);
    return { success: true, appearance };
  }

  app.get<{ Params: { id: string } }>("/api/settings/reading-font/:id", async (request, reply) => {
    const font = (await deps.appearance.appearanceDto()).readingFont;
    if (!font || font.id !== request.params.id) return reply.code(404).send({ success: false, message: "字体不存在" });
    const file = storage.filePath(font);
    try { await fs.promises.access(file); }
    catch { return reply.code(404).send({ success: false, message: "字体文件不存在" }); }
    reply.header("Content-Type", `font/${font.format}`);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Cache-Control", "public, max-age=31536000, immutable");
    return reply.send(fs.createReadStream(file));
  });

  app.post("/api/admin/appearance/reading-font", { preHandler: deps.requireAdmin }, async (request, reply) => {
    const upload = await request.file({ limits: { fileSize: READING_FONT_MAX_BYTES, files: 1 }, throwFileSizeLimit: false });
    if (!upload) return reply.code(400).send({ success: false, message: "请选择手写字体文件" });
    const bytes = await upload.toBuffer();
    if (upload.file.truncated) return reply.code(413).send({ success: false, message: "字体不能超过 30 MB" });
    const format = validateReadingFont(bytes, upload.filename);
    if (!format) return reply.code(400).send({ success: false, message: "字体内容无效，请上传 TTF、OTF、WOFF 或 WOFF2 字体" });
    return mutate(async () => {
      const previous = (await deps.appearance.appearanceDto()).readingFont;
      const font = await storage.save(bytes, upload.filename, format);
      try { await deps.appearance.setSetting(READING_FONT_SETTING, JSON.stringify(font)); }
      catch (error) { await storage.remove(font); throw error; }
      if (previous) await storage.remove(previous).catch(error => request.log.warn({ err: error }, "Unable to remove retired reading font"));
      return publish();
    });
  });

  app.delete("/api/admin/appearance/reading-font", { preHandler: deps.requireAdmin }, async (request) => mutate(async () => {
    const previous = (await deps.appearance.appearanceDto()).readingFont;
    await deps.appearance.setSetting(READING_FONT_SETTING, "");
    if (previous) await storage.remove(previous).catch(error => request.log.warn({ err: error }, "Unable to remove retired reading font"));
    return publish();
  }));
}
