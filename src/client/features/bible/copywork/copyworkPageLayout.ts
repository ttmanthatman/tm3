import { COPYWORK_PAGE, type CopyworkGlyph, type CopyworkPlacement } from "@shared/bibleCopywork";

// Crop only the presentation; persisted placements and pagination remain stable.
export function copyworkPageHeight(
  glyphs: Array<CopyworkGlyph & { index: number }>,
  placements: CopyworkPlacement[]
) {
  const bounds = new Map(glyphs.map((glyph) => [glyph.index, glyph.bounds]));
  const inkBottom = placements.reduce((bottom, placement) => {
    const glyph = bounds.get(placement.index);
    return Math.max(bottom, placement.y + (glyph?.bottom ?? 10000) * COPYWORK_PAGE.font / 10000);
  }, 110 + COPYWORK_PAGE.font);
  return Math.ceil(inkBottom + 120);
}

// Keep the original line layout, but fit the presentation around the entire ink.
export function copyworkInkViewport(
  glyphs: Array<CopyworkGlyph & { index: number }>,
  placements: CopyworkPlacement[]
) {
  const bounds = new Map(glyphs.map((glyph) => [glyph.index, glyph.bounds]));
  const scale = COPYWORK_PAGE.font / 10000;
  let left = COPYWORK_PAGE.inset as number;
  let right = COPYWORK_PAGE.width - COPYWORK_PAGE.inset;
  let top = Infinity;
  let bottom = -Infinity;
  for (const placement of placements) {
    const ink = bounds.get(placement.index);
    left = Math.min(left, placement.x + (ink?.left ?? 0) * scale);
    right = Math.max(right, placement.x + (ink?.right ?? 10000) * scale);
    top = Math.min(top, placement.y + (ink?.top ?? 0) * scale);
    bottom = Math.max(bottom, placement.y + (ink?.bottom ?? 10000) * scale);
  }
  if (!Number.isFinite(top)) { top = 110; bottom = top + COPYWORK_PAGE.font; }
  const inset = 16;
  return { x: left - inset, y: top - inset, width: right - left + inset * 2, height: bottom - top + inset * 2 };
}

/** Join legacy page placements into one continuous sheet without changing stored ink. */
export function continuousCopyworkPlacements(glyphs: Array<CopyworkGlyph & { index: number }>, pages: CopyworkPlacement[][]) {
  const result: CopyworkPlacement[] = [];
  let offset = 0;
  for (const page of pages) {
    const view = copyworkInkViewport(glyphs, page);
    result.push(...page.map((placement) => ({ ...placement, y: placement.y - view.y + 110 + offset })));
    offset += view.height + 24;
  }
  return result;
}

// Long continuous sheets keep CSS size while bounding the backing canvas.
export function copyworkCanvasSize(displayWidth: number, ratio: number, dpr: number) {
  const width = Math.max(1, Math.min(Math.round(displayWidth * Math.min(dpr, 2)),
    Math.floor(16000 * ratio), Math.floor(Math.sqrt(16_000_000 * ratio))));
  return { width, height: Math.max(1, Math.ceil(width / ratio)) };
}
