import assert from "node:assert/strict";
import test from "node:test";
import { imageDimensionsFromPayload, mergeImageDimensionsPayload, orientedImageDimensions } from "./imageDimensions.js";

test("image dimensions round-trip through message payloads", () => {
  const payload = mergeImageDimensionsPayload({ effect: "shine" }, { width: 1179, height: 2556 });
  assert.deepEqual(payload, { effect: "shine", imageWidth: 1179, imageHeight: 2556 });
  assert.deepEqual(imageDimensionsFromPayload(payload), { width: 1179, height: 2556 });
});

test("invalid image dimensions are ignored", () => {
  assert.equal(imageDimensionsFromPayload({ imageWidth: 0, imageHeight: 400 }), undefined);
  assert.equal(imageDimensionsFromPayload({ imageWidth: 400, imageHeight: 30_000 }), undefined);
  assert.equal(imageDimensionsFromPayload(null), undefined);
});

test("EXIF rotations swap the stored pixel axes used by the browser", () => {
  assert.deepEqual(orientedImageDimensions(4032, 3024, 6), { width: 3024, height: 4032 });
  assert.deepEqual(orientedImageDimensions(4032, 3024, 8), { width: 3024, height: 4032 });
  assert.deepEqual(orientedImageDimensions(4032, 3024, 1), { width: 4032, height: 3024 });
});
