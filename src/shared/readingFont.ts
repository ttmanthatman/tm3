import { z } from "zod";

export const READING_FONT_MAX_BYTES = 30 * 1024 * 1024;
export const READING_FONT_SETTING = "readingHandwritingFont";
export const readingFontSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(180),
  format: z.enum(["ttf", "otf", "woff", "woff2"])
}).strict();
export type ReadingFontDTO = z.infer<typeof readingFontSchema>;
export function readingFontUrl(font: ReadingFontDTO) {
  return `/api/settings/reading-font/${encodeURIComponent(font.id)}`;
}
export function parseReadingFont(value: string | undefined): ReadingFontDTO | null {
  if (!value) return null;
  try { return readingFontSchema.parse(JSON.parse(value)); }
  catch { return null; }
}
