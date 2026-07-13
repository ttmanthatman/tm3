export type GraphemeSlice = {
  text: string;
  start: number;
  end: number;
};

export const OOPS_MAX_GLYPHS_PER_MESSAGE = 160;
export const OOPS_MAX_GLYPHS_PER_PAGE = 240;

export function segmentTextGraphemes(value: string): GraphemeSlice[] {
  if (!value) return [];
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(segmenter.segment(value), (part) => ({
      text: part.segment,
      start: part.index,
      end: part.index + part.segment.length
    }));
  }

  const slices: GraphemeSlice[] = [];
  let offset = 0;
  for (const text of Array.from(value)) {
    slices.push({ text, start: offset, end: offset + text.length });
    offset += text.length;
  }
  return slices;
}

export function sampleWithoutReplacement<T>(items: readonly T[], limit: number, random: () => number = Math.random): T[] {
  const count = Math.max(0, Math.min(items.length, Math.floor(limit)));
  if (count >= items.length) return [...items];
  const indexes = items.map((_, index) => index);
  for (let index = 0; index < count; index += 1) {
    const remaining = indexes.length - index;
    const offset = Math.min(remaining - 1, Math.floor(Math.max(0, Math.min(0.999999999, random())) * remaining));
    const picked = index + offset;
    [indexes[index], indexes[picked]] = [indexes[picked], indexes[index]];
  }
  return indexes.slice(0, count).map((index) => items[index]);
}
