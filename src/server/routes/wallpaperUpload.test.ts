import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import sharp from "sharp";

test("wallpaper uploads validate images and clean rejected or truncated files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tm3-wallpaper-"));
  const previous = process.env.STORAGE_ROOT;
  process.env.STORAGE_ROOT = root;
  const { saveImageUpload } = await import("./appearance.js");
  const backgrounds = path.join(root, "backgrounds"); await fs.mkdir(backgrounds);
  const app = Fastify(); await app.register(multipart);
  app.post("/upload", async (request, reply) => {
    const fileName = await saveImageUpload(request, reply, "missing", false, 1024);
    if (!fileName) return reply;
    return { fileName };
  });
  const upload = (data: Buffer, filename = "test.png", mime = "image/png") => {
    const boundary = "wallpaper-test-boundary";
    const payload = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`), data, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    return app.inject({ method: "POST", url: "/upload", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, payload });
  };
  try {
    assert.equal((await upload(Buffer.from("<script>bad</script>"), "x.svg", "image/svg+xml")).statusCode, 400);
    assert.equal((await upload(Buffer.from("not an image"))).statusCode, 400);
    assert.deepEqual(await fs.readdir(backgrounds), []);
    assert.equal((await upload(Buffer.alloc(2048, 1))).statusCode, 413);
    assert.deepEqual(await fs.readdir(backgrounds), []);
    const image = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#778866" } }).png().toBuffer();
    const saved = await upload(image); assert.equal(saved.statusCode, 200);
    assert.equal((await fs.readdir(backgrounds)).includes(saved.json().fileName), true);
  } finally {
    await app.close(); await fs.rm(root, { recursive: true, force: true });
    if (previous === undefined) delete process.env.STORAGE_ROOT; else process.env.STORAGE_ROOT = previous;
  }
});
