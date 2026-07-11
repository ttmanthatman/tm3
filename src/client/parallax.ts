export type ParallaxKitId = "none" | "rural";

export type ParallaxLayer = {
  id: string;
  file: string;
  depth: number;
  doubleHeight?: boolean;
};

export type ParallaxKit = {
  id: Exclude<ParallaxKitId, "none">;
  name: string;
  description: string;
  credit: string;
  layers: ParallaxLayer[];
};

export const PARALLAX_KITS: ParallaxKit[] = [
  {
    id: "rural",
    name: "乡野河谷",
    description: "天空、云层、远山、村庄与河岸组成的十层日间景色",
    credit: "Bongseng · Parallax (Country side, city night, city destroyed)",
    layers: [
      { id: "sky", file: "ruralparallaxsky.png", depth: 0 },
      { id: "moon", file: "ruralparalaxmoon.png", depth: 0.04, doubleHeight: true },
      { id: "clouds", file: "ruralparallaxclouds.png", depth: 0.1 },
      { id: "mountain-back-2", file: "ruralparallaxmountainback2.png", depth: 0.17 },
      { id: "mountain-back", file: "ruralparallaxmountainback.png", depth: 0.24 },
      { id: "mountain", file: "ruralparallaxmountain.png", depth: 0.36 },
      { id: "village", file: "ruralparallaxvillage.png", depth: 0.52 },
      { id: "river", file: "ruralparallaxriver.png", depth: 0.7 },
      { id: "river-reflection", file: "ruralparallaxriverskyredlex.png", depth: 0.84 },
      { id: "river-front", file: "ruralparallaxriverfront.png", depth: 1 }
    ]
  }
];

export function cleanParallaxSpeed(value: unknown) {
  const speed = Number(value);
  if (!Number.isFinite(speed)) return 1;
  return Math.min(3, Math.max(0.25, Math.round(speed * 100) / 100));
}

export function parallaxKit(id: ParallaxKitId | string | null | undefined) {
  return PARALLAX_KITS.find((kit) => kit.id === id) || null;
}

export function parallaxAssetUrl(kitId: string, file: string) {
  return `/api/parallax/${encodeURIComponent(kitId)}/${encodeURIComponent(file)}`;
}
