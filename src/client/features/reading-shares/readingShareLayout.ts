// Grow the reading measure with the content, while CSS caps it to the available
// chat column. Long passages remain fully visible and grow vertically at the cap.
export function readingShareWidth(text: string): number {
  return Math.min(520, Math.max(280, Math.ceil(260 + Math.sqrt(Array.from(text).length) * 12)));
}
