export type ImageDimensions = {
  width: number;
  height: number;
};

const MAX_IMAGE_DIMENSION = 20_000;

function validDimension(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_IMAGE_DIMENSION;
}

export function imageDimensionsFromPayload(payload: unknown): ImageDimensions | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const value = payload as Record<string, unknown>;
  if (!validDimension(value.imageWidth) || !validDimension(value.imageHeight)) return undefined;
  return { width: value.imageWidth as number, height: value.imageHeight as number };
}

export function mergeImageDimensionsPayload(payload: unknown, dimensions: ImageDimensions) {
  const base = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  return { ...base, imageWidth: dimensions.width, imageHeight: dimensions.height };
}
