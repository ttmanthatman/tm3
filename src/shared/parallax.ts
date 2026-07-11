import type { ParallaxKitDTO, ParallaxLayerDTO } from "./types.js";

const KIT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LAYER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PNG_FILE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}\.png$/;

export const DEFAULT_PARALLAX_KITS: ParallaxKitDTO[] = [
  {
    id: "rural",
    name: "乡野河谷",
    description: "天空、云层、远山、村庄、远湖与近河组成的十层日间景色",
    credit: "Bongseng · Parallax (Country side, city night, city destroyed)",
    builtIn: true,
    layers: [
      { id: "sky", name: "天空", file: "ruralparallaxsky.png", speed: 0, yOffset: 0, heightScale: 1 },
      { id: "moon", name: "远处山峰", file: "ruralparalaxmoon.png", speed: 0.04, yOffset: 0, heightScale: 2 },
      { id: "clouds", name: "云层", file: "ruralparallaxclouds.png", speed: 0.1, yOffset: 0, heightScale: 1 },
      { id: "mountain-back-2", name: "远山二", file: "ruralparallaxmountainback2.png", speed: 0.12, yOffset: 0, heightScale: 1 },
      { id: "mountain-back", name: "远山一", file: "ruralparallaxmountainback.png", speed: 0.18, yOffset: 0, heightScale: 1 },
      { id: "mountain", name: "主山", file: "ruralparallaxmountain.png", speed: 0.32, yOffset: 0, heightScale: 1 },
      { id: "village", name: "村庄田野", file: "ruralparallaxvillage.png", speed: 0.55, yOffset: 0, heightScale: 1 },
      { id: "river", name: "近河水面", file: "ruralparallaxriver.png", speed: 0.72, yOffset: 0, heightScale: 1 },
      { id: "river-reflection", name: "云层倒影", file: "ruralparallaxriverskyredlex.png", speed: 0.1, yOffset: 0, heightScale: 1 },
      { id: "river-front", name: "河岸前景", file: "ruralparallaxriverfront.png", speed: 1, yOffset: 0, heightScale: 1 }
    ]
  }
];

function clamp(value: unknown, min: number, max: number, fallback: number, decimals = 2) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const factor = 10 ** decimals;
  return Math.min(max, Math.max(min, Math.round(parsed * factor) / factor));
}

export function cleanParallaxSpeed(value: unknown) {
  return clamp(value, 0.25, 3, 1);
}

export function cleanParallaxLayer(layer: unknown, fallbackIndex = 0): ParallaxLayerDTO | null {
  const row = (layer && typeof layer === "object" ? layer : {}) as Partial<ParallaxLayerDTO>;
  const id = String(row.id || `layer-${fallbackIndex + 1}`).trim().toLowerCase();
  const file = String(row.file || "").trim();
  if (!LAYER_ID_PATTERN.test(id) || !PNG_FILE_PATTERN.test(file)) return null;
  return {
    id,
    name: String(row.name || "").trim().slice(0, 40) || `图层 ${fallbackIndex + 1}`,
    file,
    speed: clamp(row.speed, 0, 3, 1),
    yOffset: clamp(row.yOffset, -600, 600, 0, 0),
    heightScale: clamp(row.heightScale, 0.25, 4, 1)
  };
}

function cloneDefaultKits() {
  return DEFAULT_PARALLAX_KITS.map((kit) => ({ ...kit, layers: kit.layers.map((layer) => ({ ...layer })) }));
}

export function cleanParallaxKits(input: unknown): ParallaxKitDTO[] {
  if (!Array.isArray(input)) return cloneDefaultKits();
  const kits: ParallaxKitDTO[] = [];
  const seenKits = new Set<string>();
  for (const item of input.slice(0, 12)) {
    const row = (item && typeof item === "object" ? item : {}) as Partial<ParallaxKitDTO>;
    const id = String(row.id || "").trim().toLowerCase();
    if (!KIT_ID_PATTERN.test(id) || seenKits.has(id)) continue;
    const seenLayers = new Set<string>();
    const layers: ParallaxLayerDTO[] = [];
    for (const [index, layer] of (Array.isArray(row.layers) ? row.layers : []).slice(0, 32).entries()) {
      const cleaned = cleanParallaxLayer(layer, index);
      if (!cleaned || seenLayers.has(cleaned.id)) continue;
      seenLayers.add(cleaned.id);
      layers.push(cleaned);
    }
    if (!layers.length) continue;
    seenKits.add(id);
    kits.push({
      id,
      name: String(row.name || "").trim().slice(0, 40) || "自定义卷轴",
      description: String(row.description || "").trim().slice(0, 120),
      credit: String(row.credit || "").trim().slice(0, 120),
      builtIn: id === "rural",
      layers
    });
  }
  if (!seenKits.has("rural")) kits.unshift(...cloneDefaultKits());
  return kits;
}

export function parallaxKit(kits: ParallaxKitDTO[], id: string | null | undefined) {
  return kits.find((kit) => kit.id === id) || null;
}
