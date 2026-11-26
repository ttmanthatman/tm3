import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import type { PrismaClient } from "@prisma/client";
import { READING_FONT_MAX_BYTES, READING_FONT_SETTING, readingFontUrl } from "../../shared/readingFont.js";
import { createAppearanceService, registerAppearanceRoutes } from "./appearance.js";
import { registerReadingFontRoutes } from "./readingFont.js";
import { validateReadingFont } from "../services/readingFont.js";

function fontBytes() {
  const bytes = Buffer.alloc(140);
  bytes.writeUInt32BE(0x10000); bytes.writeUInt16BE(4, 4);
  ["cmap", "head", "maxp", "name"].forEach((tag, index) => {
    const at = 12 + index * 16;
    bytes.write(tag, at); bytes.writeUInt32BE(76 + index * 16, at + 8); bytes.writeUInt32BE(16, at + 12);
  });
  return bytes;
}
const boundary = "tm3-reading-font-boundary";
function upload(bytes: Buffer, name = "handwriting.ttf") {
  return {
    method: "POST" as const, url: "/api/admin/appearance/reading-font",
    headers: { authorization: "admin", "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      bytes, Buffer.from(`\r\n--${boundary}--\r\n`)
    ])
  };
}
async function harness() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tm3-reading-font-"));
  const settings = new Map<string, string>();
  const broadcasts: unknown[] = [];
  let failSave = false;
  const prisma = { setting: {
    findMany: async () => [...settings].map(([key, value]) => ({ key, value })),
    upsert: async ({ where, update }: { where: { key: string }; update: { value: string } }) => {
      if (failSave) throw new Error("test database failure");
      settings.set(where.key, update.value);
    }
  } } as unknown as PrismaClient;
  const app = Fastify({ bodyLimit: READING_FONT_MAX_BYTES + 4096 });
  await app.register(multipart, { limits: { fileSize: Infinity, files: 1 } });
  const appearance = createAppearanceService({ prisma });
  const requireAdmin = async (request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => {
    if (request.headers.authorization !== "admin") return reply.code(403).send({ success: false });
  };
  const io = { emit: (_event: string, payload: unknown) => broadcasts.push(payload) };
  registerAppearanceRoutes(app, { appearance, requireAdmin, io, applyFileValidation: () => false });
  registerReadingFontRoutes(app, { appearance, requireAdmin, io, directory });
  return { app, settings, broadcasts, directory, failSave: () => { failSave = true; }, async close() { await app.close(); await fs.rm(directory, { recursive: true, force: true }); } };
}

test("global font is admin-only to change, public to load, persistent and broadcast to all clients", async () => {
  const h = await harness();
  try {
    const denied = await h.app.inject({ ...upload(fontBytes()), headers: { ...upload(fontBytes()).headers, authorization: "member" } });
    assert.equal(denied.statusCode, 403);
    assert.equal((await h.app.inject({ method: "DELETE", url: "/api/admin/appearance/reading-font" })).statusCode, 403);
    assert.deepEqual(await fs.readdir(h.directory), []);
    const saved = await h.app.inject(upload(fontBytes(), "我的手写字体.ttf"));
    assert.equal(saved.statusCode, 200);
    const font = saved.json().appearance.readingFont;
    assert.equal(font.name, "我的手写字体.ttf");
    const publicAppearance = (await h.app.inject("/api/settings/appearance")).json();
    assert.deepEqual(publicAppearance.readingFont, font);
    assert.deepEqual(h.broadcasts.at(-1), publicAppearance);
    assert.deepEqual((await createAppearanceService({ prisma: { setting: { findMany: async () => [...h.settings].map(([key, value]) => ({ key, value })) } } as unknown as PrismaClient }).appearanceDto()).readingFont, font);
    const download = await h.app.inject(readingFontUrl(font));
    assert.equal(download.statusCode, 200);
    assert.equal(download.headers["content-type"], "font/ttf");
    assert.equal(download.headers["x-content-type-options"], "nosniff");
    assert.deepEqual(download.rawPayload, fontBytes());
    assert.equal((await h.app.inject("/api/settings/reading-font/not-a-version")).statusCode, 404);
    const replaced = await h.app.inject(upload(fontBytes(), "replacement.ttf"));
    assert.equal(replaced.statusCode, 200);
    assert.notEqual(replaced.json().appearance.readingFont.id, font.id);
    assert.equal((await h.app.inject(readingFontUrl(font))).statusCode, 404);
    assert.equal((await fs.readdir(h.directory)).length, 1);
    const reset = await h.app.inject({ method: "DELETE", url: "/api/admin/appearance/reading-font", headers: { authorization: "admin" } });
    assert.equal(reset.statusCode, 200);
    assert.equal(reset.json().appearance.readingFont, null);
    assert.equal(h.settings.get(READING_FONT_SETTING), "");
    assert.deepEqual(h.broadcasts.at(-1), reset.json().appearance);
    assert.deepEqual(await fs.readdir(h.directory), []);
  } finally { await h.close(); }
});

test("invalid, empty, oversized and mismatched font uploads preserve the configured font", async () => {
  const h = await harness();
  try {
    await h.app.inject(upload(fontBytes()));
    const previous = h.settings.get(READING_FONT_SETTING);
    for (const [bytes, name] of [[Buffer.from("<script>bad</script>"), "bad.ttf"], [Buffer.alloc(0), "empty.ttf"], [fontBytes(), "script.js"], [fontBytes(), "wrong.otf"]] as const) {
      assert.equal((await h.app.inject(upload(bytes, name))).statusCode, 400);
      assert.equal(h.settings.get(READING_FONT_SETTING), previous);
    }
    assert.equal((await h.app.inject(upload(Buffer.alloc(READING_FONT_MAX_BYTES + 1)))).statusCode, 413);
    assert.equal(h.settings.get(READING_FONT_SETTING), previous);
    assert.equal(h.broadcasts.length, 1);
    assert.equal((await fs.readdir(h.directory)).length, 1);
  } finally { await h.close(); }
});

test("a failed database save rolls back the new file and preserves the previous font", async () => {
  const h = await harness();
  try {
    const saved = await h.app.inject(upload(fontBytes()));
    const previous = h.settings.get(READING_FONT_SETTING);
    h.failSave();
    assert.equal((await h.app.inject(upload(fontBytes(), "new.ttf"))).statusCode, 500);
    assert.equal(h.settings.get(READING_FONT_SETTING), previous);
    assert.equal((await h.app.inject(readingFontUrl(saved.json().appearance.readingFont))).statusCode, 200);
    assert.equal((await fs.readdir(h.directory)).length, 1);
    assert.equal(h.broadcasts.length, 1);
    assert.equal((await h.app.inject({ method: "DELETE", url: "/api/admin/appearance/reading-font", headers: { authorization: "admin" } })).statusCode, 500);
    assert.equal((await fs.readdir(h.directory)).length, 1);
  } finally { await h.close(); }
});

test("font container validation rejects out-of-bounds tables", () => {
  const bytes = fontBytes();
  assert.equal(validateReadingFont(bytes, "valid.ttf"), "ttf");
  bytes.writeUInt32BE(10000, 20);
  assert.equal(validateReadingFont(bytes, "invalid.ttf"), null);
});
