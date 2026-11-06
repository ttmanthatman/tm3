import type { AppearanceDTO } from "./types.js";

export type WallpaperConfig = Pick<AppearanceDTO, "wallpaperPath" | "wallpaperFit" | "wallpaperPanFocusX" | "wallpaperPanDirection" | "wallpaperPanSpeed">;
export type WallpaperPreference = { mode: "follow" | "personal" | "off"; config?: WallpaperConfig };
export type WallpaperImage = { id: string; fileName: string; contributorId: number; contributorName: string; createdAt: string; withdrawn?: boolean; banned?: boolean };
export type WallpaperState = { images: WallpaperImage[]; shared: WallpaperConfig; version: string; updatedBy: string; preference: WallpaperPreference };
export const defaultWallpaper: WallpaperConfig = { wallpaperPath: null, wallpaperFit: "cover", wallpaperPanFocusX: 0.5, wallpaperPanDirection: "left", wallpaperPanSpeed: 0.18 };
export function effectiveWallpaper(state: WallpaperState | null, appearance: WallpaperConfig): WallpaperConfig {
  if (!state) return appearance;
  const config = state.preference.mode === "off" ? defaultWallpaper : state.preference.mode === "personal" ? state.preference.config || defaultWallpaper : state.shared;
  return state.images.some(image => image.fileName === config.wallpaperPath && image.banned) ? defaultWallpaper : config;
}
export function wallpaperFitPresentation(fit: WallpaperConfig["wallpaperFit"]) {
  if (fit === "pan") return { size: "auto 100%", repeat: "no-repeat" };
  if (fit === "contain") return { size: "contain", repeat: "no-repeat" };
  if (fit === "stretch") return { size: "100% 100%", repeat: "no-repeat" };
  if (fit === "repeat") return { size: "auto", repeat: "repeat" };
  return { size: "cover", repeat: "no-repeat" };
}
