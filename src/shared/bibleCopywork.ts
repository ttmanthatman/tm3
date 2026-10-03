import {
  HANDWRITING_SEND_LIMITS,
  normalizeHandwritingPayload,
  type HandwritingCharacter
} from "./handwriting.js";

export const COPYWORK_MAX_CHARACTERS = 500;
export const COPYWORK_MAX_POINTS = 2_000_000;
export const COPYWORK_MAX_BYTES = 32 * 1024 * 1024;
export type CopyworkSpacing = "compact" | "normal" | "loose";
export type InkBounds = { left: number; top: number; right: number; bottom: number };
export type CopyworkGlyph = { character: HandwritingCharacter; bounds: InkBounds };
export type CopyworkSource = {
  translation: string;
  translationName: string;
  copyright: string;
  bookCode: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
  reference: string;
  text: string;
};
export type CopyworkDTO = {
  id: string;
  accountId: number;
  author: string;
  source: CopyworkSource;
  spacing: CopyworkSpacing;
  completedAt: string;
  publishedAt: string | null;
  pageCount: number;
};
export type CopyworkMessagePayload = { kind: "bible_copywork"; workId: string; reference: string };
export type CopyworkPlacement = { index: number; x: number; y: number };
export const COPYWORK_PAGE = { width: 720, height: 960, inset: 68, font: 72, bottom: 820 } as const;
export function copyworkCharacters(text: string): string[] {
  return Array.from(text).filter((char) => !/\s/u.test(char));
}
export function normalizeCopyworkGlyph(value: unknown): CopyworkGlyph {
  if (!value || typeof value !== "object") throw new Error("字迹格式无效");
  const glyph = value as Record<string, unknown>;
  const payload = normalizeHandwritingPayload(
    { kind: "handwriting", version: 1, characters: [glyph.character] },
    { ...HANDWRITING_SEND_LIMITS, maxCharacters: 1, maxPoints: 4000, maxBytes: 65536 }
  );
  const bounds = glyph.bounds as InkBounds | undefined;
  if (
    !bounds ||
    ![bounds.left, bounds.right, bounds.top, bounds.bottom].every(
      (n) => Number.isFinite(n) && n >= -5000 && n <= 15000
    ) ||
    bounds.right <= bounds.left ||
    bounds.bottom <= bounds.top
  )
    throw new Error("墨迹边界无效");
  return {
    character: payload.characters[0],
    bounds: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom }
  };
}
export function copyworkPayload(value: unknown): CopyworkMessagePayload | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  return row.kind === "bible_copywork" &&
    typeof row.workId === "string" &&
    typeof row.reference === "string"
    ? { kind: "bible_copywork", workId: row.workId, reference: row.reference }
    : null;
}
// All surfaces, including playback, use the same immutable full-ink placements.
export function layoutCopywork(
  bounds: InkBounds[],
  text: string,
  spacing: CopyworkSpacing
): CopyworkPlacement[][] {
  const { font, inset, width, bottom } = COPYWORK_PAGE;
  const scale = font / 10000;
  const gap = font * { compact: 0.09, normal: 0.14, loose: 0.21 }[spacing];
  const chars = copyworkCharacters(text);
  const closing = /^[，。！？；：、）》」』】〕〉…,.!?;:)\]}]$/u;
  const opening = /^[（《「『【〔〈(\[{]$/u;
  const lines: number[][] = [];
  let line: number[] = [];
  let used = 0;
  bounds.forEach((b, index) => {
    const inkWidth = (b.right - b.left) * scale;
    if (line.length && used + gap + inkWidth > width - inset * 2) {
      const carry: number[] = [];
      if (closing.test(chars[index] || "")) {
        do {
          carry.unshift(line.pop()!);
        } while (line.length && closing.test(chars[carry[0]] || ""));
      } else {
        while (line.length && opening.test(chars[line.at(-1)!] || "")) carry.unshift(line.pop()!);
      }
      if (line.length) lines.push(line);
      line = carry;
      used =
        carry.reduce((sum, i) => sum + (bounds[i].right - bounds[i].left) * scale, 0) +
        Math.max(0, carry.length - 1) * gap;
    }
    used += (line.length ? gap : 0) + inkWidth;
    line.push(index);
  });
  if (line.length) lines.push(line);
  const pages: CopyworkPlacement[][] = [[]];
  let y = 110;
  for (const indices of lines) {
    const top = Math.min(0, ...indices.map((i) => bounds[i].top * scale));
    const lower = Math.max(font, ...indices.map((i) => bounds[i].bottom * scale));
    const height = lower - top;
    if (y + height > bottom && pages.at(-1)!.length) {
      pages.push([]);
      y = 110;
    }
    let x = inset;
    for (const index of indices) {
      const b = bounds[index];
      pages.at(-1)!.push({ index, x: x - b.left * scale, y: y - top });
      x += (b.right - b.left) * scale + gap;
    }
    y += height + font * 0.38;
  }
  return pages;
}
