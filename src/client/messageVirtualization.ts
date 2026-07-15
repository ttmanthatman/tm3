export type VirtualTimelineItem = {
  key: string;
  estimatedHeight: number;
};

export type VirtualTimelineWindow = {
  start: number;
  end: number;
  topSpacer: number;
  bottomSpacer: number;
  renderedHeight: number;
  totalHeight: number;
};

type ImageDimensions = { width: number; height: number };

export function estimatedImageTimelineHeight(dimensions: ImageDimensions | undefined, viewportWidth: number) {
  if (!dimensions) return 280;
  const availableWidth = viewportWidth > 0 ? viewportWidth * 0.62 : 260;
  const renderedWidth = Math.min(dimensions.width, 260, availableWidth);
  return Math.round((renderedWidth * dimensions.height) / dimensions.width + 36);
}

type VirtualWindowInput = {
  items: VirtualTimelineItem[];
  measuredHeights: Record<string, number>;
  scrollTop: number;
  viewportHeight: number;
  overscanBefore: number;
  overscanAfter: number;
};

function itemHeight(item: VirtualTimelineItem, measuredHeights: Record<string, number>) {
  const measured = measuredHeights[item.key];
  return Number.isFinite(measured) && measured > 0 ? measured : Math.max(1, item.estimatedHeight);
}

export function virtualTimelineOffsets(items: VirtualTimelineItem[], measuredHeights: Record<string, number>) {
  const offsets = new Array<number>(items.length + 1);
  offsets[0] = 0;
  for (let index = 0; index < items.length; index += 1) {
    offsets[index + 1] = offsets[index] + itemHeight(items[index], measuredHeights);
  }
  return offsets;
}

function lowerBound(offsets: number[], target: number) {
  let low = 0;
  let high = offsets.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function calculateVirtualWindow(input: VirtualWindowInput): VirtualTimelineWindow {
  if (!input.items.length) return { start: 0, end: 0, topSpacer: 0, bottomSpacer: 0, renderedHeight: 0, totalHeight: 0 };
  const offsets = virtualTimelineOffsets(input.items, input.measuredHeights);
  const totalHeight = offsets[offsets.length - 1];
  const startTarget = Math.max(0, input.scrollTop - Math.max(0, input.overscanBefore));
  const endTarget = Math.min(totalHeight, input.scrollTop + Math.max(0, input.viewportHeight) + Math.max(0, input.overscanAfter));
  const start = Math.max(0, Math.min(input.items.length - 1, lowerBound(offsets, startTarget + Number.EPSILON) - 1));
  const end = Math.max(start + 1, Math.min(input.items.length, lowerBound(offsets, endTarget)));
  const topSpacer = offsets[start];
  const renderedHeight = offsets[end] - topSpacer;
  return {
    start,
    end,
    topSpacer,
    bottomSpacer: Math.max(0, totalHeight - offsets[end]),
    renderedHeight,
    totalHeight
  };
}

export function virtualItemOffset(items: VirtualTimelineItem[], measuredHeights: Record<string, number>, key: string) {
  const index = items.findIndex((item) => item.key === key);
  if (index < 0) return null;
  return virtualTimelineOffsets(items, measuredHeights)[index];
}
