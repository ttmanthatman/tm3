export const MAX_BIBLE_PANES = 4;
export const MIN_BIBLE_PANE_PERCENT = 18;

export type BibleSplitOrientation = "columns" | "rows";

export function biblePaneLabel(index: number) {
  return String.fromCharCode("A".charCodeAt(0) + Math.max(0, Math.min(MAX_BIBLE_PANES - 1, index)));
}

export function equalBiblePaneSizes(count: number) {
  const safeCount = Math.max(1, Math.min(MAX_BIBLE_PANES, Math.floor(count) || 1));
  const size = roundPanePercent(100 / safeCount);
  const sizes = Array.from({ length: safeCount }, () => size);
  sizes[sizes.length - 1] = roundPanePercent(100 - sizes.slice(0, -1).reduce((total, value) => total + value, 0));
  return sizes;
}

export function normalizeBiblePaneSizes(sizes: readonly number[], count: number) {
  const safeCount = Math.max(1, Math.min(MAX_BIBLE_PANES, Math.floor(count) || 1));
  if (sizes.length !== safeCount || sizes.some((value) => !Number.isFinite(value) || value <= 0)) {
    return equalBiblePaneSizes(safeCount);
  }
  const total = sizes.reduce((sum, value) => sum + value, 0);
  if (!total) return equalBiblePaneSizes(safeCount);
  const normalized = sizes.map((value) => roundPanePercent(value / total * 100));
  normalized[normalized.length - 1] = roundPanePercent(100 - normalized.slice(0, -1).reduce((sum, value) => sum + value, 0));
  return normalized;
}

export function resizeBiblePanePair(sizes: readonly number[], separatorIndex: number, deltaPercent: number) {
  if (separatorIndex < 0 || separatorIndex >= sizes.length - 1 || !Number.isFinite(deltaPercent)) return [...sizes];
  const next = [...sizes];
  const pairTotal = next[separatorIndex] + next[separatorIndex + 1];
  const minimum = Math.min(MIN_BIBLE_PANE_PERCENT, pairTotal / 2);
  const first = clamp(next[separatorIndex] + deltaPercent, minimum, pairTotal - minimum);
  next[separatorIndex] = roundPanePercent(first);
  next[separatorIndex + 1] = roundPanePercent(pairTotal - first);
  return next;
}

export function resolveBibleLinkTargetPaneId(
  paneIds: readonly string[],
  sourcePaneId: string,
  receivingPaneId: string | null
) {
  if (!paneIds.length) return null;
  if (receivingPaneId && paneIds.includes(receivingPaneId)) return receivingPaneId;
  const sourceIndex = paneIds.indexOf(sourcePaneId);
  if (sourceIndex < 0) return paneIds[0];
  return paneIds[(sourceIndex + 1) % paneIds.length];
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundPanePercent(value: number) {
  return Math.round(value * 10_000) / 10_000;
}
