/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import { buildBookCSS, globalFraction, nudgeFromSectionBoundaries } from "./reader.js";

test("globalFraction converts section fraction to whole-book fraction", () => {
  const starts = [0, 0.25, 0.5, 0.75, 1];
  assert.equal(globalFraction(starts, 0, 0), 0);
  assert.equal(globalFraction(starts, 1, 0.5), 0.375);
  assert.equal(globalFraction(starts, 3, 1), 0.9999);
  assert.equal(globalFraction(starts, 0, 1), 0.25);
});

test("globalFraction clamps extreme fraction values", () => {
  const starts = [0, 0.5, 1];
  assert.equal(globalFraction(starts, 1, 10), 0.9999);
  assert.equal(globalFraction(starts, 0, -1), 0);
});

test("nudgeFromSectionBoundaries pushes boundary values inside their section", () => {
  const starts = [0, 0.2428, 0.5, 0.7506, 1];
  const nudged = nudgeFromSectionBoundaries(starts, 0.7506);
  assert.ok(Math.abs(nudged - 0.7506) >= 1e-4 - 1e-9);
  assert.ok(nudged < 0.7506);
  // 非边界值原样返回
  assert.equal(nudgeFromSectionBoundaries(starts, 0.42), 0.42);
});

test("buildBookCSS reflects theme, font size and spacing", () => {
  const dark = buildBookCSS({ theme: "dark", fontPct: 120, spacing: 1.8, flow: "paginated" });
  assert.match(dark, /#161617/);
  assert.match(dark, /font-size: 120%/);
  assert.match(dark, /line-height: 1\.8/);
  const sepia = buildBookCSS({ theme: "sepia", fontPct: 100, spacing: 1.6, flow: "scrolled" });
  assert.match(sepia, /#f7f0e0/);
});
