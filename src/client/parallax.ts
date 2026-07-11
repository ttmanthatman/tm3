export { DEFAULT_PARALLAX_KITS, cleanParallaxKits, cleanParallaxLayer, cleanParallaxSpeed, parallaxKit } from "@shared/parallax";
export type { ParallaxKitDTO, ParallaxLayerDTO } from "@shared/types";

export function parallaxAssetUrl(kitId: string, file: string) {
  return `/api/parallax/${encodeURIComponent(kitId)}/${encodeURIComponent(file)}`;
}
