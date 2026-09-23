import type { HandwritingPayload, HandwritingPoint } from "@shared/handwriting";

export const HANDWRITING_TIMELINE_CHARACTER_GAP_MS = 250;
export const HANDWRITING_TIMELINE_MAX_IDLE_MS = 500;
export const HANDWRITING_TIMELINE_LONG_IDLE_MS = 1_000;
export const HANDWRITING_TIMELINE_MAX_DURATION_MS = 15_000;

export type HandwritingTimelinePoint = {
  characterIndex: number;
  strokeIndex: number;
  pointIndex: number;
  point: HandwritingPoint;
  at: number;
};

export type HandwritingTimeline = {
  events: readonly HandwritingTimelinePoint[];
  durationMs: number;
};

function safeTime(value: number, fallback = 0) {
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

export function buildHandwritingTimeline(
  payload: HandwritingPayload,
  options: { maxDurationMs?: number } = {}
): HandwritingTimeline {
  const events: HandwritingTimelinePoint[] = [];
  let cursor = 0;
  for (const [characterIndex, character] of payload.characters.entries()) {
    if (characterIndex) cursor += HANDWRITING_TIMELINE_CHARACTER_GAP_MS;
    let previousEnd = 0;
    for (const [strokeIndex, stroke] of character.strokes.entries()) {
      const firstPoint = stroke.points[0];
      const idle = safeTime(firstPoint[2] - previousEnd);
      cursor += idle > HANDWRITING_TIMELINE_LONG_IDLE_MS ? HANDWRITING_TIMELINE_MAX_IDLE_MS : idle;
      for (const [pointIndex, point] of stroke.points.entries()) {
        const previous = stroke.points[pointIndex - 1];
        if (previous) cursor += safeTime(point[2] - previous[2]);
        events.push({ characterIndex, strokeIndex, pointIndex, point, at: cursor });
      }
      previousEnd = safeTime(stroke.points.at(-1)?.[2] ?? previousEnd, previousEnd);
    }
  }

  const maxDurationMs = Math.max(1, safeTime(options.maxDurationMs ?? HANDWRITING_TIMELINE_MAX_DURATION_MS, HANDWRITING_TIMELINE_MAX_DURATION_MS));
  const rawDuration = events.at(-1)?.at ?? 0;
  const scale = rawDuration > maxDurationMs ? maxDurationMs / rawDuration : 1;
  const scaledEvents = scale === 1 ? events : events.map((event) => ({ ...event, at: Math.max(0, Math.round(event.at * scale)) }));
  return { events: scaledEvents, durationMs: scaledEvents.at(-1)?.at ?? 0 };
}

export function visiblePointCountAt(timeline: HandwritingTimeline, elapsedMs: number) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 0;
  const elapsed = elapsedMs;
  let low = 0;
  let high = timeline.events.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (timeline.events[middle].at <= elapsed) low = middle + 1;
    else high = middle;
  }
  return low;
}
