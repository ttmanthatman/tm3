import assert from "node:assert/strict";
import test from "node:test";
import { calculateVirtualWindow, estimatedImageTimelineHeight, virtualItemOffset, type VirtualTimelineItem } from "./messageVirtualization.js";

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
    overscanBefore: 3_200,
    overscanAfter: 320
  });

  assert.ok(window.start > 0);
  assert.ok(window.end < items.length);
  assert.ok(window.end - window.start <= 60);
  assert.equal(window.topSpacer + window.renderedHeight + window.bottomSpacer, 40_000);
  assert.ok(window.topSpacer <= 12_800);
  assert.ok(window.topSpacer + window.renderedHeight >= 16_800);
});

test("backward overscan can preload static rows without expanding the forward window", () => {
  const window = calculateVirtualWindow({
    items,
    measuredHeights: {},
    scrollTop: 20_000,
    viewportHeight: 800,
    overscanBefore: 4_000,
    overscanAfter: 0
  });

  assert.equal(window.start, 199);
  assert.equal(window.end, 260);
});

test("measured dynamic heights update offsets and total spacer height", () => {
  const measuredHeights = { "message:2": 240, "message:4": 40 };
  assert.equal(virtualItemOffset(items, measuredHeights, "message:3"), 320);

  const window = calculateVirtualWindow({
    items: items.slice(0, 5),
    measuredHeights,
    scrollTop: 0,
    viewportHeight: 200,
    overscanBefore: 0,
    overscanAfter: 0
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
    overscanBefore: 320,
    overscanAfter: 320
  });
  assert.deepEqual({ start: window.start, end: window.end, top: window.topSpacer, bottom: window.bottomSpacer }, { start: 0, end: 8, top: 0, bottom: 0 });
});

test("image estimates preserve tall-image aspect ratios", () => {
  assert.equal(estimatedImageTimelineHeight({ width: 1179, height: 2556 }, 758), 600);
  assert.equal(estimatedImageTimelineHeight({ width: 1242, height: 883 }, 758), 221);
  assert.equal(estimatedImageTimelineHeight(undefined, 758), 280);
});
