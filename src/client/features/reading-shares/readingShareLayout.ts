// Grow the reading measure with the content, while CSS caps it to the available
// chat column. Long passages remain fully visible and grow vertically at the cap.
export function readingShareWidth(text: string): number {
  return Math.min(520, Math.max(280, Math.ceil(260 + Math.sqrt(Array.from(text).length) * 12)));
}

// A send's random request UUID keeps its plant consistent across recipients,
// favorites and reloads. Older messages fall back to their immutable message ID.
export const READING_SHARE_PLANTS = {
  book: ["cosmos", "lavender", "fern", "daisy", "poppy", "camellia", "ginkgo", "eucalyptus", "bellflower", "rosemary", "sunflower", "hydrangea"],
  bible: ["olive", "vine", "fig", "pomegranate", "date-palm", "wheat", "barley", "mustard", "almond", "lily", "cedar", "hyssop"]
} as const;

export function readingSharePlant(seed: string | number = "", kind: "book" | "bible" = "book"): string {
  let hash = 0;
  for (const character of String(seed)) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  return READING_SHARE_PLANTS[kind][hash % READING_SHARE_PLANTS[kind].length]!;
}

export function readingSharePlantImage(seed: string | number, kind: "book" | "bible"): string {
  const plant = readingSharePlant(seed, kind);
  return new URL(`./assets/plants/${kind}-${plant}.webp`, import.meta.url).href;
}
