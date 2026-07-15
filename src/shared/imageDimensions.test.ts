import assert from "node:assert/strict";
import test from "node:test";
import { imageDimensionsFromPayload, mergeImageDimensionsPayload } from "./imageDimensions.js";

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
