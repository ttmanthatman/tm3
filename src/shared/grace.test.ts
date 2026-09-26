import assert from "node:assert/strict";
import test from "node:test";
import { graceImages, graceImageFiles } from "./grace.js";

test("grace image references include history, deduplicate, and reject unsafe names", () => {
  const photo = { fileName: "00000000-0000-0000-0000-000000000001.webp", width: 8, height: 8 };
  const history = { fileName: "00000000-0000-0000-0000-000000000002.webp", width: 8, height: 8 };
  const payload = { images: [photo, { fileName: "../private.webp" }, null], updates: [{ images: [photo, history] }] };
  assert.deepEqual(graceImages(payload), [photo]);
  assert.deepEqual(graceImageFiles(payload), [photo.fileName, history.fileName]);
  assert.deepEqual(graceImageFiles(null), []);
});
