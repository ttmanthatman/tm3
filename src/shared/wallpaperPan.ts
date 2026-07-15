export type WallpaperPanDirection = "left" | "right";

export const DEFAULT_WALLPAPER_PAN_FOCUS_X = 0.5;
export const DEFAULT_WALLPAPER_PAN_DIRECTION: WallpaperPanDirection = "left";
export const DEFAULT_WALLPAPER_PAN_SPEED = 0.18;
export const WALLPAPER_PAN_SPEED_MIN = 0.02;
export const WALLPAPER_PAN_SPEED_MAX = 1;

export type WallpaperPanBounds = {
  imageWidth: number;
  minOffset: number;
  maxOffset: number;
  viewportWidth: number;
};

export function cleanWallpaperPanFocusX(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_WALLPAPER_PAN_FOCUS_X;
  return Math.max(0, Math.min(1, parsed));
}

export function cleanWallpaperPanDirection(value: unknown): WallpaperPanDirection {
  return value === "right" ? "right" : DEFAULT_WALLPAPER_PAN_DIRECTION;
}

export function cleanWallpaperPanSpeed(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_WALLPAPER_PAN_SPEED;
  return Math.max(WALLPAPER_PAN_SPEED_MIN, Math.min(WALLPAPER_PAN_SPEED_MAX, parsed));
}

export function wallpaperPanBounds(viewportWidth: number, viewportHeight: number, naturalWidth: number, naturalHeight: number): WallpaperPanBounds {
  const safeViewportWidth = Math.max(0, viewportWidth);
  const safeViewportHeight = Math.max(0, viewportHeight);
  const safeNaturalWidth = Math.max(0, naturalWidth);
  const safeNaturalHeight = Math.max(0, naturalHeight);
  const imageWidth = safeNaturalHeight > 0 ? (safeNaturalWidth / safeNaturalHeight) * safeViewportHeight : 0;
  const centeredOffset = (safeViewportWidth - imageWidth) / 2;
  const hasHorizontalOverflow = imageWidth > safeViewportWidth;
  return {
    imageWidth,
    minOffset: hasHorizontalOverflow ? safeViewportWidth - imageWidth : centeredOffset,
    maxOffset: hasHorizontalOverflow ? 0 : centeredOffset,
    viewportWidth: safeViewportWidth
  };
}

export function initialWallpaperPanOffset(bounds: WallpaperPanBounds, focusX: unknown) {
  if (bounds.imageWidth <= bounds.viewportWidth) return bounds.maxOffset;
  const desired = bounds.viewportWidth / 2 - bounds.imageWidth * cleanWallpaperPanFocusX(focusX);
  return Math.max(bounds.minOffset, Math.min(bounds.maxOffset, desired));
}

export function wallpaperPanTransform(offset: number) {
  const safeOffset = Number.isFinite(offset) ? offset : 0;
  return `translate3d(${safeOffset.toFixed(2)}px, 0, 0)`;
}

export function wallpaperPanLayerPresentation(imageWidth: number, offset: number) {
  const safeWidth = Number.isFinite(imageWidth) ? Math.max(0, imageWidth) : 0;
  return {
    width: `${safeWidth.toFixed(2)}px`,
    transform: wallpaperPanTransform(offset)
  };
}

export function advanceWallpaperPan(
  offset: number,
  direction: WallpaperPanDirection,
  distance: number,
  bounds: Pick<WallpaperPanBounds, "minOffset" | "maxOffset">
) {
  const min = Math.min(bounds.minOffset, bounds.maxOffset);
  const max = Math.max(bounds.minOffset, bounds.maxOffset);
  if (max - min <= 0.001 || distance <= 0) return { offset: Math.max(min, Math.min(max, offset)), direction };

  let nextOffset = Math.max(min, Math.min(max, offset));
  let nextDirection = direction;
  let remaining = Math.max(0, distance);
  while (remaining > 0.001) {
    const boundary = nextDirection === "left" ? min : max;
    const available = Math.abs(boundary - nextOffset);
    if (remaining < available) {
      nextOffset += (nextDirection === "left" ? -1 : 1) * remaining;
      remaining = 0;
      continue;
    }
    nextOffset = boundary;
    remaining -= available;
    nextDirection = nextDirection === "left" ? "right" : "left";
  }
  return { offset: nextOffset, direction: nextDirection };
}
