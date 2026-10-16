// Grow the reading measure with the content, while CSS caps it to the available
// chat column. Long passages remain fully visible and grow vertically at the cap.
export function readingShareWidth(text: string): number {
  return Math.min(520, Math.max(280, Math.ceil(260 + Math.sqrt(Array.from(text).length) * 12)));
}

// A send's random request UUID keeps its plant consistent across recipients,
// favorites and reloads. Older messages fall back to their immutable message ID.
export function readingSharePlant(seed: string | number = ""): "flowers" | "lavender" | "fern" {
  let hash = 0;
  for (const character of String(seed)) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  return (["flowers", "lavender", "fern"] as const)[hash % 3];
}
