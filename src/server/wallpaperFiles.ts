import type { PrismaClient } from "@prisma/client";
import type { WallpaperImage, WallpaperConfig } from "../shared/wallpaper.js";

// Attachment administration must preserve wallpaper references when recompressing,
// and clear them before deleting physical files.
export async function updateWallpaperFileReferences(prisma: PrismaClient, oldName: string, newName: string | null) {
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: "wallpaper:" } } });
  let changed = false;
  for (const row of rows) {
    const value = JSON.parse(row.value) as WallpaperImage & { config?: WallpaperConfig };
    let update = false;
    if (row.key.startsWith("wallpaper:image:") && value.fileName === oldName) {
      if (newName) value.fileName = newName;
      else { value.banned = true; value.withdrawn = true; }
      update = true;
    }
    if (value.config?.wallpaperPath === oldName) { value.config.wallpaperPath = newName; update = true; }
    if (update) { await prisma.setting.update({ where: { key: row.key }, data: { value: JSON.stringify(value) } }); changed = true; }
  }
  return changed;
}
