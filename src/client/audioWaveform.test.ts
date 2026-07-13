import assert from "node:assert/strict";
import test from "node:test";
import { computeWaveformGeometry, resampleWaveform } from "./audioWaveform.js";

test("responsive waveform changes bar count without changing physical bar thickness", () => {
  const narrow = computeWaveformGeometry(275, 1.3);
  const wide = computeWaveformGeometry(420, 1.3);

  assert.equal(narrow.barWidthPx, wide.barWidthPx);
  assert.equal(narrow.gapPx, wide.gapPx);
  assert.ok(wide.barCount > narrow.barCount);
  assert.ok(narrow.usedWidthPx <= narrow.canvasWidthPx);
  assert.ok(narrow.canvasWidthPx - narrow.usedWidthPx < narrow.barWidthPx + narrow.gapPx);
});

test("waveform resampling produces one normalized value for every rendered bar", () => {
  const source = [0.1, 0.8, 0.3, 1, 0.2];
  const dense = resampleWaveform(source, 97);
  const compact = resampleWaveform(source, 3);

  assert.equal(dense.length, 97);
  assert.equal(compact.length, 3);
  assert.ok(dense.every((value) => value >= 0.08 && value <= 1));
  assert.ok(compact.every((value) => value >= 0.08 && value <= 1));
});
