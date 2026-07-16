export function nearbyBibleChapterPreloadOrder(currentChapter: number, chapterCount: number, limit = 5) {
  const safeCount = Math.max(0, Math.floor(chapterCount));
  const current = Math.max(1, Math.min(safeCount, Math.floor(currentChapter)));
  const safeLimit = Math.max(0, Math.floor(limit));
  if (!safeCount || !safeLimit) return [];
  const order = [current];
  for (let distance = 1; order.length < safeLimit && order.length < safeCount; distance += 1) {
    if (current + distance <= safeCount) order.push(current + distance);
    if (order.length >= safeLimit) break;
    if (current - distance >= 1) order.push(current - distance);
  }
  return order;
}

export function preservedScrollTop(currentScrollTop: number, anchorTopBefore: number, anchorTopAfter: number) {
  return currentScrollTop + anchorTopAfter - anchorTopBefore;
}
