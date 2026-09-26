import type { GraceImage, GraceVoice } from "./types.js";

export const GRACE_IMAGE_LIMIT = 9;
export const GRACE_IMAGE_NAME = /^[a-f0-9-]{36}\.webp$/;
export const GRACE_VOICE_NAME = /^[a-f0-9-]{36}\.m4a$/;

export function graceNativeVoice(payload: unknown): GraceVoice | null {
  if (!payload || typeof payload !== "object" || !("nativeVoice" in payload)) return null;
  const voice = payload.nativeVoice;
  if (!voice || typeof voice !== "object" || !("fileName" in voice) || typeof voice.fileName !== "string" || !GRACE_VOICE_NAME.test(voice.fileName)) return null;
  return {
    fileName: voice.fileName,
    durationMs: "durationMs" in voice && typeof voice.durationMs === "number" && Number.isFinite(voice.durationMs) && voice.durationMs > 0 ? voice.durationMs : null,
    mimeType: "audio/mp4"
  };
}

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

export function graceMediaFiles(payload: unknown): string[] {
  const files = graceImageFiles(payload);
  const voice = graceNativeVoice(payload);
  if (voice) files.push(voice.fileName);
  return [...new Set(files)];
}
