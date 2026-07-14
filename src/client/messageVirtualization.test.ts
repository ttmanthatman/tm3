import assert from "node:assert/strict";
import test from "node:test";
import { calculateVirtualWindow, virtualItemOffset, type VirtualTimelineItem } from "./messageVirtualization.js";

const items: VirtualTimelineItem[] = Array.from({ length: 500 }, (_, index) => ({
  key: `message:${index + 1}`,
  estimatedHeight: 80
}));

test("large timelines render only a bounded window around the viewport", () => {
  const window = calculateVirtualWindow({
    items,
    measuredHeights: {},
    scrollTop: 16_000,
    viewportHeight: 800,
    overscan: 320
  });

  assert.ok(window.start > 0);
  assert.ok(window.end < items.length);
  assert.ok(window.end - window.start <= 24);
  assert.equal(window.topSpacer + window.renderedHeight + window.bottomSpacer, 40_000);
  assert.ok(window.topSpacer <= 16_000);
  assert.ok(window.topSpacer + window.renderedHeight >= 16_800);
});

test("measured dynamic heights update offsets and total spacer height", () => {
  const measuredHeights = { "message:2": 240, "message:4": 40 };
  assert.equal(virtualItemOffset(items, measuredHeights, "message:3"), 320);

  const window = calculateVirtualWindow({
    items: items.slice(0, 5),
    measuredHeights,
    scrollTop: 0,
    viewportHeight: 200,
    overscan: 0
  });
  assert.equal(window.totalHeight, 520);
  assert.equal(window.start, 0);
  assert.equal(window.end, 2);
});

test("small timelines can be rendered without spacer bookkeeping", () => {
  const window = calculateVirtualWindow({
    items: items.slice(0, 8),
    measuredHeights: {},
    scrollTop: 0,
    viewportHeight: 800,
    overscan: 320
  });
  assert.deepEqual({ start: window.start, end: window.end, top: window.topSpacer, bottom: window.bottomSpacer }, { start: 0, end: 8, top: 0, bottom: 0 });
});
