import assert from "node:assert/strict";
import test from "node:test";
import { graceImages, graceImageFiles, graceMediaFiles, graceNativeVoice } from "./grace.js";

test("grace image references include history, deduplicate, and reject unsafe names", () => {
  const photo = { fileName: "00000000-0000-0000-0000-000000000001.webp", width: 8, height: 8 };
  const history = { fileName: "00000000-0000-0000-0000-000000000002.webp", width: 8, height: 8 };
  const payload = { images: [photo, { fileName: "../private.webp" }, null], updates: [{ images: [photo, history] }] };
  assert.deepEqual(graceImages(payload), [photo]);
  assert.deepEqual(graceImageFiles(payload), [photo.fileName, history.fileName]);
  assert.deepEqual(graceImageFiles(null), []);
});

test("independent grace voice references are validated and included in attachment lifecycle", () => {
  const voice = { fileName: "00000000-0000-0000-0000-000000000001.m4a", durationMs: 1500, mimeType: "audio/mp4" };
  const image = { fileName: "00000000-0000-0000-0000-000000000002.webp", width: 8, height: 8 };
  assert.deepEqual(graceNativeVoice({ nativeVoice: voice }), voice);
  assert.deepEqual(graceMediaFiles({ nativeVoice: voice, images: [image], updates: [{ images: [image] }] }), [image.fileName, voice.fileName]);
  assert.equal(graceNativeVoice({ nativeVoice: { fileName: "../private.m4a" } }), null);
  assert.equal(graceNativeVoice({ nativeVoice: { ...voice, durationMs: Infinity } })?.durationMs, null);
  assert.deepEqual(graceMediaFiles(null), []);
});
