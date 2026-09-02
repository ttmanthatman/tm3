export interface ChainPopoverRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface ChainPopoverSize {
  width: number;
  height: number;
}

export interface ChainPopoverViewport {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type ChainPopoverPlacement = "right" | "left" | "below" | "above";

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function positionChainPopover(
  anchor: ChainPopoverRect,
  popover: ChainPopoverSize,
  viewport: ChainPopoverViewport,
  options: { margin?: number; gap?: number } = {}
) {
  const margin = options.margin ?? 12;
  const gap = options.gap ?? 8;
  const minimumX = viewport.left + margin;
  const minimumY = viewport.top + margin;
  const maximumX = Math.max(minimumX, viewport.right - margin - popover.width);
  const maximumY = Math.max(minimumY, viewport.bottom - margin - popover.height);
  const centeredX = anchor.left + (anchor.width - popover.width) / 2;
  const centeredY = anchor.top + (anchor.height - popover.height) / 2;
  const candidates: Array<{ placement: ChainPopoverPlacement; x: number; y: number }> = [
    { placement: "right", x: anchor.right + gap, y: centeredY },
    { placement: "left", x: anchor.left - gap - popover.width, y: centeredY },
    { placement: "below", x: centeredX, y: anchor.bottom + gap },
    { placement: "above", x: centeredX, y: anchor.top - gap - popover.height }
  ];

  const ranked = candidates.map((candidate, priority) => {
    const x = clamp(candidate.x, minimumX, maximumX);
    const y = clamp(candidate.y, minimumY, maximumY);
    const displacement = Math.abs(candidate.x - x) + Math.abs(candidate.y - y);
    return { ...candidate, x, y, score: displacement * 100 + priority };
  });
  const best = ranked.reduce((selected, candidate) => candidate.score < selected.score ? candidate : selected);
  return { x: best.x, y: best.y, placement: best.placement };
}
