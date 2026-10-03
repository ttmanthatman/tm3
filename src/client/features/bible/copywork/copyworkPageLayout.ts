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
