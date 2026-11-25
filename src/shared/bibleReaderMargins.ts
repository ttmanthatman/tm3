export const BIBLE_READER_MARGIN_MIN = 8;
export const BIBLE_READER_MARGIN_MAX = 96;

export function cleanBibleReaderMargin(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(BIBLE_READER_MARGIN_MAX, Math.max(BIBLE_READER_MARGIN_MIN, Math.round(value)));
}
