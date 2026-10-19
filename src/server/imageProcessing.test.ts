import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import sharp from "sharp";
import { convertHeicImageFile } from "./imageProcessing.js";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "tm3-heic-"));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

test("convertHeicImageFile turns an HEIC upload into a same-resolution webp", async () => {
  const input = path.join(scratch, "photo.heic");
  fs.copyFileSync(new URL("../../e2e/fixtures/story-sample.heic", import.meta.url), input);

  const result = await convertHeicImageFile(input, scratch);

  assert.match(result.fileName, /\.webp$/);
  const output = path.join(scratch, result.fileName);
  assert.equal(result.size, fs.statSync(output).size);
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 80);
  assert.equal(metadata.height, 60);
});

test("convertHeicImageFile keeps png resolution through the same decoder", async () => {
  const input = path.join(scratch, "banner.png");
  await sharp({ create: { width: 96, height: 48, channels: 3, background: "#94a37c" } }).png().toFile(input);

  const result = await convertHeicImageFile(input, scratch);

  const metadata = await sharp(path.join(scratch, result.fileName)).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 96);
  assert.equal(metadata.height, 48);
});

test("convertHeicImageFile rejects a corrupt payload and leaves no webp behind", async () => {
  const input = path.join(scratch, "broken.heic");
  fs.writeFileSync(input, Buffer.from("not an image"));
  const before = fs.readdirSync(scratch).filter((name) => name.endsWith(".webp"));

  await assert.rejects(() => convertHeicImageFile(input, scratch));

  assert.deepEqual(fs.readdirSync(scratch).filter((name) => name.endsWith(".webp")), before);
});
