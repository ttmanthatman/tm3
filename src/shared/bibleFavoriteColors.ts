export const BIBLE_FAVORITE_COLOR_PRESETS = [
  { name: "淡红", color: "#f28b82" },
  { name: "橙色", color: "#fb8c00" },
  { name: "金黄", color: "#f9ab00" },
  { name: "绿色", color: "#34a853" },
  { name: "青色", color: "#00acc1" },
  { name: "蓝色", color: "#4285f4" },
  { name: "紫色", color: "#a142f4" }
] as const;

export const DEFAULT_BIBLE_FAVORITE_COLOR = BIBLE_FAVORITE_COLOR_PRESETS[0].color;

const BIBLE_FAVORITE_COLORS = new Set<string>(BIBLE_FAVORITE_COLOR_PRESETS.map((preset) => preset.color));

export function normalizeBibleFavoriteColor(input: unknown) {
  const color = String(input || "").trim().toLowerCase();
  return BIBLE_FAVORITE_COLORS.has(color) ? color : DEFAULT_BIBLE_FAVORITE_COLOR;
}
