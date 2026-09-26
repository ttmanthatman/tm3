import type { GraceImage } from "./types.js";

export const GRACE_IMAGE_LIMIT = 9;
export const GRACE_IMAGE_NAME = /^[a-f0-9-]{36}\.webp$/;

export function graceImages(payload: unknown): GraceImage[] {
  if (!payload || typeof payload !== "object" || !("images" in payload) || !Array.isArray(payload.images)) return [];
  return payload.images.filter((image): image is GraceImage => !!image && typeof image === "object"
    && typeof image.fileName === "string" && GRACE_IMAGE_NAME.test(image.fileName));
}

export function graceImageFiles(payload: unknown): string[] {
  const files = graceImages(payload).map((image) => image.fileName);
  if (payload && typeof payload === "object" && "updates" in payload && Array.isArray(payload.updates)) {
    for (const update of payload.updates) files.push(...graceImages(update).map((image) => image.fileName));
  }
  return [...new Set(files)];
}
