import assert from "node:assert/strict";
import test from "node:test";
import { COPYWORK_PAGE, layoutCopywork, type CopyworkGlyph } from "@shared/bibleCopywork";
import { copyworkPageHeight } from "./copyworkPageLayout";

function glyph(index: number, bottom = 9000): CopyworkGlyph & { index: number } {
  return { index, character: { strokes: [{ points: [[0, 0, 0]] }] }, bounds: { left: 0, right: 9000, top: 0, bottom } };
}

test("short folios crop unused paper while more lines grow the canvas", () => {
  const short = [glyph(0)];
  const long = Array.from({ length: 50 }, (_, index) => glyph(index));
  const shortPages = layoutCopywork(short.map((g) => g.bounds), "字", "normal");
  const longPages = layoutCopywork(long.map((g) => g.bounds), "字".repeat(50), "normal");
  const shortHeight = copyworkPageHeight(short, shortPages[0]);
  const longHeight = copyworkPageHeight(long, longPages[0]);
  assert.ok(shortHeight < COPYWORK_PAGE.height / 2);
  assert.ok(longHeight > shortHeight * 2);
  assert.equal(copyworkPageHeight([], []), shortHeight);
});

test("height follows full ink bounds on this page without modifying placements during playback", () => {
  const glyphs = [glyph(0, 15000), glyph(1)];
  const placements = [{ index: 0, x: 68, y: 110 }, { index: 1, x: 68, y: 730 }];
  const before = structuredClone(placements);
  assert.equal(copyworkPageHeight(glyphs, [placements[0]]), 110 + 108 + 120);
  assert.equal(copyworkPageHeight(glyphs, [placements[1]]), Math.ceil(730 + 64.8 + 120));
  assert.equal(copyworkPageHeight([], [placements[1]]), 730 + 72 + 120);
  assert.deepEqual(placements, before);
});
