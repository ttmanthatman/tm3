import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tm3-thumbs-"));
process.env.STORAGE_ROOT = storageRoot;

const originalListen = net.Server.prototype.listen;
net.Server.prototype.listen = function (this: net.Server) {
  return this;
} as typeof net.Server.prototype.listen;
const { writeImageThumbnail } = await import("./index.js");
net.Server.prototype.listen = originalListen;

function caseDir(context: { after: (fn: () => void) => void }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tm3-thumb-case-"));
  context.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("writeImageThumbnail writes a bounded webp variant for large images", async (context) => {
  const dir = caseDir(context);
  const source = path.join(dir, "large.webp");
  await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 40, g: 90, b: 160 } } }).png().toFile(source);

  await writeImageThumbnail(source);

  const thumbPath = `${source}.thumb.webp`;
  assert.equal(fs.existsSync(thumbPath), true);
  const metadata = await sharp(thumbPath).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 480);
  assert.equal(metadata.height, 320);
});

test("writeImageThumbnail skips images already within the thumb budget", async (context) => {
  const dir = caseDir(context);
  const source = path.join(dir, "small.webp");
  await sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 10, g: 20, b: 30 } } }).webp().toFile(source);

  await writeImageThumbnail(source);

  assert.equal(fs.existsSync(`${source}.thumb.webp`), false);
});

test("writeImageThumbnail is idempotent and survives corrupt inputs", async (context) => {
  const dir = caseDir(context);
  const source = path.join(dir, "large2.webp");
  await sharp({ create: { width: 2000, height: 1000, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toFile(source);
  await writeImageThumbnail(source);
  const firstStat = fs.statSync(`${source}.thumb.webp`);
  await writeImageThumbnail(source);
  assert.equal(fs.statSync(`${source}.thumb.webp`).size, firstStat.size);

  const corrupt = path.join(dir, "corrupt.webp");
  fs.writeFileSync(corrupt, "not an image");
  await writeImageThumbnail(corrupt);
  assert.equal(fs.existsSync(`${corrupt}.thumb.webp`), false);
});
