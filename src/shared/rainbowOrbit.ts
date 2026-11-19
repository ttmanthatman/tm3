export interface RainbowOrbitSettings {
  innerWidth: number;
  outerWidth: number;
  colors: string[];
}
export const RAINBOW_MAX_COLORS = 99;
export const RAINBOW_MAX_WIDTH = 40;
export const DEFAULT_RAINBOW_COLORS = ["#ef6161", "#efef61", "#61ef61", "#61efef", "#6161ef", "#ef61ef"];
export function cleanRainbowOrbit(input?: unknown): RainbowOrbitSettings {
  const value = input && typeof input === "object" ? input as Partial<RainbowOrbitSettings> : {};
  const width = (v: unknown, fallback: number) => typeof v === "number" && Number.isFinite(v)
    ? Math.max(0, Math.min(RAINBOW_MAX_WIDTH, Math.round(v))) : fallback;
  const colors = Array.isArray(value.colors) ? value.colors.filter((c): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c)).slice(0, RAINBOW_MAX_COLORS) : [];
  return { innerWidth: width(value.innerWidth, 10), outerWidth: width(value.outerWidth, 18), colors: colors.length ? [...colors] : [...DEFAULT_RAINBOW_COLORS] };
}
/** Interpolate cyclically, including the last-to-first seam. */
export function rainbowSamples(settings: RainbowOrbitSettings): string[] {
  const colors = cleanRainbowOrbit(settings).colors;
  const count = Math.max(120, colors.length * 4);
  const rgb = colors.map(c => [1, 3, 5].map(start => parseInt(c.slice(start, start + 2), 16)));
  return Array.from({ length: count }, (_, i) => {
    const position = i * colors.length / count;
    const index = Math.floor(position), fraction = position - index;
    const next = rgb[(index + 1) % rgb.length];
    return `rgb(${rgb[index].map((v, j) => Math.round(v + (next[j] - v) * fraction)).join(" ")})`;
  });
}
