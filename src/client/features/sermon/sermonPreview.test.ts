import assert from "node:assert/strict";
import test from "node:test";
import { sermonPreviewScale } from "./sermonPreview.js";

test("sermonPreviewScale fills a matching projector or phone frame", () => {
  assert.equal(sermonPreviewScale(640, 360, 1280, 720), 0.5);
  assert.equal(sermonPreviewScale(195, 422.5, 390, 845), 0.5);
});

test("sermonPreviewScale fits both axes and rejects unusable measurements", () => {
  assert.equal(sermonPreviewScale(640, 300, 1280, 720), 300 / 720);
  assert.equal(sermonPreviewScale(0, 300, 1280, 720), 0);
  assert.equal(sermonPreviewScale(640, 300, 0, 720), 0);
});
