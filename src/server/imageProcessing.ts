import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { orientedImageDimensions, type ImageDimensions } from "../shared/imageDimensions.js";

export const IMAGE_WEBP_QUALITY = 82;
export const IMAGE_WEBP_EFFORT = 5;
export const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif", ".tif", ".tiff"]);

// Wired to the Fastify logger by the app entry point; kept injectable so this
// module stays free of app-instance state.
export const imageProcessingLog: { warn: (data: Record<string, unknown>, message: string) => void } = {
  warn: () => {}
};

export function isImageFileName(name?: string | null) {
  return IMAGE_EXTENSIONS.has(path.extname(name || "").toLowerCase());
}

export function wantsOriginalImage(fields: Record<string, { value?: string }>) {
  const value = String(fields.originalImage?.value || fields.original?.value || "").toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export function compressedImageFileName(shortName = false) {
  return `${shortName ? crypto.randomBytes(5).toString("hex") : crypto.randomUUID()}.webp`;
}

export function shortStorageFileName(ext: string) {
  const tokenLength = Math.max(4, 16 - ext.length);
  return `${crypto.randomBytes(Math.ceil(tokenLength / 2)).toString("hex").slice(0, tokenLength)}${ext}`;
}

export function displayWebpFileName(name: string) {
  const base = path.basename(name, path.extname(name)).trim() || "image";
  return `${base}.webp`;
}

export async function compressImageFile(inputPath: string, outputDir: string, options: { shortName?: boolean; maxDimension?: number } = {}) {
  const originalStat = fs.statSync(inputPath);
  const outputName = compressedImageFileName(options.shortName);
  const outputPath = path.join(outputDir, outputName);
  try {
    let pipeline = sharp(inputPath, { animated: true, failOn: "error", limitInputPixels: 40_000_000 }).rotate();
    if (options.maxDimension) {
      pipeline = pipeline.resize({ width: options.maxDimension, height: options.maxDimension, fit: "inside", withoutEnlargement: true });
    }
    await pipeline
      .webp({ quality: IMAGE_WEBP_QUALITY, effort: IMAGE_WEBP_EFFORT, smartSubsample: true })
      .toFile(outputPath);
    const outputStat = fs.statSync(outputPath);
    if (outputStat.size >= originalStat.size) {
      fs.unlinkSync(outputPath);
      return null;
    }
    return {
      fileName: outputName,
      filePath: outputPath,
      size: outputStat.size,
      originalSize: originalStat.size,
      savedBytes: originalStat.size - outputStat.size
    };
  } catch (error) {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    imageProcessingLog.warn({ error, inputPath }, "image compression failed");
    return null;
  }
}

export async function validateStoredImage(filePath: string) {
  try {
    const metadata = await sharp(filePath, { failOn: "error", limitInputPixels: 40_000_000 }).metadata();
    return !!metadata.format && !!metadata.width && !!metadata.height && metadata.width <= 20_000 && metadata.height <= 20_000;
  } catch {
    return false;
  }
}

export const IMAGE_THUMB_MAX_DIMENSION = 480;

// Chat bubbles render at ~260px but used to transfer the full-size image;
// keep a small webp variant next to the stored file for bubble rendering and
// preload warming. Served through /api/files/:id?thumb=1 with a server-side
// fallback to the original when no thumbnail exists (older uploads).
export async function writeImageThumbnail(storedPath: string) {
  const thumbPath = `${storedPath}.thumb.webp`;
  if (fs.existsSync(thumbPath)) return;
  try {
    const source = sharp(storedPath, { animated: true, failOn: "error", limitInputPixels: 40_000_000 });
    const metadata = await source.metadata();
    if (!metadata.width || !metadata.height || Math.max(metadata.width, metadata.height) <= IMAGE_THUMB_MAX_DIMENSION) return;
    await sharp(storedPath, { animated: true, failOn: "error", limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: IMAGE_THUMB_MAX_DIMENSION, height: IMAGE_THUMB_MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 78, effort: IMAGE_WEBP_EFFORT, smartSubsample: true })
      .toFile(thumbPath);
  } catch (error) {
    if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
    imageProcessingLog.warn({ error, storedPath }, "image thumbnail failed");
  }
}

export async function storedImageDimensions(filePath: string): Promise<ImageDimensions | undefined> {
  try {
    const metadata = await sharp(filePath, { failOn: "error", limitInputPixels: 40_000_000 }).metadata();
    if (!metadata.width || !metadata.height || metadata.width > 20_000 || metadata.height > 20_000) return undefined;
    return orientedImageDimensions(metadata.width, metadata.height, metadata.orientation);
  } catch {
    return undefined;
  }
}
