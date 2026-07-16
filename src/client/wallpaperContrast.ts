export type WallpaperLabelTone = "light" | "dark";

const LIGHT_TEXT_MAX_LUMINANCE = 145;

function toneForLuminance(luminance: number): WallpaperLabelTone {
  return luminance <= LIGHT_TEXT_MAX_LUMINANCE ? "light" : "dark";
}

export function wallpaperLabelTone(color: string): WallpaperLabelTone {
  const match = color.trim().match(/^#([0-9a-f]{6})$/i);
  if (!match) return "dark";
  const value = match[1];
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return toneForLuminance(red * 0.299 + green * 0.587 + blue * 0.114);
}

export function wallpaperLabelToneFromPixels(pixels: Uint8ClampedArray): WallpaperLabelTone {
  let luminance = 0;
  let weight = 0;
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    const alpha = pixels[index + 3] / 255;
    if (!alpha) continue;
    luminance += (pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114) * alpha;
    weight += alpha;
  }
  return weight ? toneForLuminance(luminance / weight) : "dark";
}
