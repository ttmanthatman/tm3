/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import { buildBookCSS, globalFraction, nudgeFromSectionBoundaries, readerLayoutMetrics, DEFAULT_READER_STYLE } from "./reader.js";

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
  const dark = buildBookCSS({ theme: "dark", fontPct: 120, spacing: 1.8, margin: 48, flow: "paginated" });
  assert.match(dark, /#161617/);
  assert.match(dark, /font-size: 120%/);
  assert.match(dark, /line-height: 1\.8/);
  const sepia = buildBookCSS({ theme: "sepia", fontPct: 100, spacing: 1.6, margin: 48, flow: "scrolled" });
  assert.match(sepia, /#f7f0e0/);
});

test("readerLayoutMetrics maps margin to foliate layout attributes", () => {
  // 桌面横屏双栏：正文栏宽 = (舞台宽 − 边距×2) / 2
  const desktop = readerLayoutMetrics({ ...DEFAULT_READER_STYLE, margin: 16, flow: "paginated" }, 1849, 1000);
  assert.equal(desktop.maxInlineSize, Math.round((1849 - 32) / 2));
  // gap 百分比反解后折成 px 应约等于边距：a/(1+a)×宽 ≈ 16
  const gapPx = (desktop.gapPct / 100) / (1 + desktop.gapPct / 100) * 1849;
  assert.ok(Math.abs(gapPx - 16) < 1);
  assert.equal(desktop.margin, 16);

  // 竖屏/滚动：单栏，栏宽 = 舞台宽 − 边距×2
  const portrait = readerLayoutMetrics({ ...DEFAULT_READER_STYLE, margin: 48, flow: "paginated" }, 390, 844);
  assert.equal(portrait.maxInlineSize, 390 - 96);
  const scrolled = readerLayoutMetrics({ ...DEFAULT_READER_STYLE, margin: 48, flow: "scrolled" }, 1849, 1000);
  assert.equal(scrolled.maxInlineSize, 1849 - 96);

  // 舞台尺寸未知时回退 foliate 默认值
  const fallback = readerLayoutMetrics(DEFAULT_READER_STYLE, 0, 0);
  assert.deepEqual(fallback, { margin: 48, maxInlineSize: 720, gapPct: 7 });

  // 极小舞台：栏宽有下限，不会算出非法值
  const tiny = readerLayoutMetrics({ ...DEFAULT_READER_STYLE, margin: 96 }, 200, 100);
  assert.ok(tiny.maxInlineSize >= 120);
});
