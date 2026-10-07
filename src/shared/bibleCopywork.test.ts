import assert from "node:assert/strict";
import test from "node:test";
import {
  copyworkCharacters,
  layoutCopywork,
  normalizeCopyworkGlyph,
  skippedCopyworkGlyph,
  COPYWORK_PAGE
} from "./bibleCopywork.js";
const wide = { left: 500, right: 9500, top: 700, bottom: 9500 };
const narrow = { left: 6500, right: 7500, top: 8000, bottom: 9000 };
test("ink spacing follows actual edges without stretching narrow or offset glyphs", () => {
  const [line] = layoutCopywork([wide, narrow, wide], "神，爱", "normal");
  const scale = COPYWORK_PAGE.font / 10000;
  assert.ok(
    Math.abs(
      line[1].x + narrow.left * scale - (line[0].x + wide.right * scale) - COPYWORK_PAGE.font * 0.14
    ) < 1e-8
  );
  assert.equal(line[0].y, line[1].y);
  assert.ok(line[2].x - line[1].x < COPYWORK_PAGE.font);
});
test("explicit skipped characters reserve a rewritable blank slot without weakening ink validation", () => {
  const skipped = skippedCopyworkGlyph();
  assert.deepEqual(normalizeCopyworkGlyph(JSON.parse(JSON.stringify(skipped))), skipped);
  assert.throws(() => normalizeCopyworkGlyph({ character: { strokes: [] }, bounds: wide }));
  assert.throws(() => normalizeCopyworkGlyph({ ...skipped, skipped: false }));
  assert.throws(() => normalizeCopyworkGlyph({ ...skipped, character: { strokes: [{ points: [[0, 0, 0]] }] } }));
  const placements = layoutCopywork([wide, skipped.bounds, narrow], "神爱人", "normal").flat();
  assert.deepEqual(placements.map((placement) => placement.index), [0, 1, 2]);
  assert.ok(placements[2].x + narrow.left * COPYWORK_PAGE.font / 10000 > placements[1].x + COPYWORK_PAGE.font);
});
test("500 characters paginate at a fixed scale and punctuation stays with preceding text", () => {
  const chars = Array.from({ length: 500 }, (_, i) => (i % 8 === 7 ? "，" : "爱")).join("");
  const pages = layoutCopywork(
    Array.from({ length: 500 }, () => wide),
    chars,
    "normal"
  );
  assert.ok(pages.length > 1);
  assert.equal(pages.flat().length, 500);
  for (const page of pages)
    for (const p of page) {
      assert.ok(p.y + (wide.bottom * COPYWORK_PAGE.font) / 10000 <= COPYWORK_PAGE.bottom);
      const isStart = !page.some((other) => other.y === p.y && other.x < p.x);
      if (isStart) assert.notEqual(chars[p.index], "，");
    }
});
test("whitespace is not a handwriting prompt and invalid ink bounds are rejected", () => {
  assert.deepEqual(copyworkCharacters("神 爱\n世人。"), ["神", "爱", "世", "人", "。"]);
  const character = { strokes: [{ points: [[100, 200, 0]] }] };
  assert.throws(() => normalizeCopyworkGlyph({ character, bounds: { ...wide, left: NaN } }));
  assert.throws(() => normalizeCopyworkGlyph({ character, bounds: { ...wide, left: wide.right } }));
  assert.deepEqual(normalizeCopyworkGlyph({ character, bounds: wide }).bounds, wide);
});
