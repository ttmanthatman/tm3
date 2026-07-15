import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deduplicateStoredUpload, sha256File } from "./uploadDeduplication.js";

test("identical bytes are reused even when file names differ", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tm3-upload-dedupe-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const original = path.join(directory, "first-name.pdf");
  const candidate = path.join(directory, "totally-different-name.pdf");
  fs.writeFileSync(original, Buffer.from("same file body\n", "utf8"));
  fs.writeFileSync(candidate, Buffer.from("same file body\n", "utf8"));

  assert.equal(await sha256File(original), await sha256File(candidate));
  const result = await deduplicateStoredUpload({ directory, candidatePath: candidate });

  assert.equal(result.duplicate, true);
  assert.equal(result.storedFileName, "first-name.pdf");
  assert.equal(fs.existsSync(candidate), false);
  assert.equal(fs.readFileSync(original, "utf8"), "same file body\n");
});

test("unique files receive a stable content-addressed storage name", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tm3-upload-canonical-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const candidate = path.join(directory, "temporary-name.mp3");
  fs.writeFileSync(candidate, Buffer.from("unique audio body", "utf8"));
  const hash = await sha256File(candidate);

  const result = await deduplicateStoredUpload({ directory, candidatePath: candidate });

  assert.equal(result.duplicate, false);
  assert.equal(result.storedFileName, `${hash}.mp3`);
  assert.equal(fs.existsSync(path.join(directory, result.storedFileName)), true);
  assert.equal(fs.existsSync(candidate), false);
});

test("the original content hash reuses a transformed image body", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tm3-upload-transform-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sourceHash = "a".repeat(64);
  const existing = path.join(directory, `${sourceHash}.webp`);
  const candidate = path.join(directory, "new-compressed-image.webp");
  fs.writeFileSync(existing, Buffer.from("first transformed output", "utf8"));
  fs.writeFileSync(candidate, Buffer.from("different transform of same input", "utf8"));

  const result = await deduplicateStoredUpload({ directory, candidatePath: candidate, contentHash: sourceHash });

  assert.equal(result.duplicate, true);
  assert.equal(result.storedFileName, `${sourceHash}.webp`);
  assert.equal(fs.existsSync(candidate), false);
});

test("music deduplication prefers the file already referenced by the song library", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tm3-upload-preferred-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const content = Buffer.from("same existing song", "utf8");
  const canonical = path.join(directory, `${"b".repeat(64)}.mp3`);
  const libraryFile = path.join(directory, "legacy-library-track.mp3");
  const candidate = path.join(directory, "renamed-song.mp3");
  fs.writeFileSync(canonical, content);
  fs.writeFileSync(libraryFile, content);
  fs.writeFileSync(candidate, content);

  const result = await deduplicateStoredUpload({
    directory,
    candidatePath: candidate,
    contentHash: "b".repeat(64),
    preferredFileNames: [path.basename(libraryFile)]
  });

  assert.equal(result.storedFileName, path.basename(libraryFile));
});
