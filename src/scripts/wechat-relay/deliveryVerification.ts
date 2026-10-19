import sharp from "sharp";

export async function deliveryImageChange(beforePath: string, afterPath: string) {
  const before = await sharp(beforePath).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  const after = await sharp(afterPath).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  if (before.info.width !== after.info.width || before.info.height !== after.info.height || !before.data.length) {
    throw new Error("Unable to compare delivery verification images");
  }
  let difference = 0;
  let changedPixels = 0;
  // Fixed-size tiles keep a small notification visible at every window size.
  const columns = Math.ceil(before.info.width / 96);
  const tiles = new Map<number, { difference: number; pixels: number }>();
  for (let index = 0; index < before.data.length; index += 1) {
    const change = Math.abs(before.data[index] - after.data[index]);
    difference += change;
    if (change >= 16) changedPixels += 1;
    const x = index % before.info.width;
    const y = Math.floor(index / before.info.width);
    const key = Math.floor(y / 48) * columns + Math.floor(x / 96);
    const tile = tiles.get(key) ?? { difference: 0, pixels: 0 };
    tile.difference += change;
    tile.pixels += 1;
    tiles.set(key, tile);
  }
  const average = difference / before.data.length / 255;
  const local = Math.max(...Array.from(tiles.values(), (tile) => tile.difference / tile.pixels / 255));
  return { average, local, changedPixels };
}

export async function composerWasCleared(emptyPath: string, stagedPath: string, afterPath: string) {
  const staged = await deliveryImageChange(emptyPath, stagedPath);
  const remaining = await deliveryImageChange(emptyPath, afterPath);
  // Allow a blinking caret, but never accept a composer that still contains the
  // staged text. A paste that didn't visibly insert text must not reach Enter.
  return staged.changedPixels >= 64
    && remaining.changedPixels <= Math.max(24, staged.changedPixels * 0.15)
    && remaining.average < staged.average * 0.25;
}
