import assert from "node:assert/strict";
import test from "node:test";
import { createDripGeometry, findDripCollision } from "./dripGeometry";

test("a fast falling drop hits the first crossed bubble even when its next position is below it", () => {
  const rect = (id: number, top: number) => ({ id, width: 100, height: 20, layerLeft: 10, layerRight: 110, layerTop: top, layerBottom: top + 20 });
  const rects = new Map([[3, rect(3, 100)], [1, rect(1, 10)], [2, rect(2, 60)]]);
  const particle = { x: 50, y: 140, radius: 3, vy: 1800, sourceId: 1 };
  assert.equal(findDripCollision(particle, 35, rects)?.id, 2);
  assert.equal(findDripCollision({ ...particle, x: 200 }, 35, rects), undefined);
  assert.equal(findDripCollision(particle, 125, rects), undefined);
});

test("stationary bubbles reuse geometry, while scrolling, layout and message changes invalidate it", () => {
  const globals = ["window", "ResizeObserver", "MutationObserver", "KeyframeEffect"] as const;
  const originals = globals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  let layoutChanged: () => void = () => undefined;
  let nodesChanged: (records: Array<{ type: string; attributeName?: string }>) => void = () => undefined;
  let disconnects = 0;
  class Resize {
    constructor(callback: () => void) { layoutChanged = callback; }
    observe() {}
    disconnect() { disconnects += 1; }
  }
  class Mutation {
    constructor(callback: typeof nodesChanged) { nodesChanged = callback; }
    observe() {}
    disconnect() { disconnects += 1; }
  }
  class MotionEffect {
    getKeyframes() { return [{ transform: "translateX(3px)" }]; }
  }
  const fakeWindow = new EventTarget();
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: Resize });
  Object.defineProperty(globalThis, "MutationObserver", { configurable: true, value: Mutation });
  Object.defineProperty(globalThis, "KeyframeEffect", { configurable: true, value: MotionEffect });
  let reads = 0;
  let queries = 0;
  let top = 40;
  const animations: Array<{ playState: string; effect: MotionEffect }> = [];
  const bubble = { getAnimations: () => animations, getBoundingClientRect: () => { reads += 1; return { left: 10, right: 110, top, bottom: top + 30, width: 100, height: 30 }; } };
  const row = { dataset: { messageId: "1" }, getAnimations: () => [], querySelector: () => bubble };
  const rows = [row];
  const root = Object.assign(new EventTarget(), { querySelectorAll: () => { queries += 1; return rows; } });
  const layer = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 844 }) };
  const cache = createDripGeometry({ scroller: () => root as unknown as HTMLElement, layer: () => layer as unknown as HTMLCanvasElement });
  try {
    assert.equal(cache.snapshot()?.rects.get(1)?.layerTop, 40);
    for (let frame = 0; frame < 60; frame += 1) cache.snapshot();
    assert.equal(reads, 1);
    assert.equal(queries, 1);
    top = 20; root.dispatchEvent(new Event("scroll"));
    assert.equal(cache.snapshot()?.rects.get(1)?.layerTop, 20);
    assert.equal(queries, 1, "scroll must reuse the element list");
    top = 70; layoutChanged();
    assert.equal(cache.snapshot()?.rects.get(1)?.layerTop, 70);
    rows.length = 0; nodesChanged([{ type: "childList" }]);
    assert.equal(cache.snapshot()?.rects.size, 0, "virtualized messages must leave the collision map");
    assert.equal(queries, 2);
    cache.stop();
    assert.ok(disconnects >= 2);
    rows.push(row);
    assert.equal(cache.snapshot()?.rects.size, 1, "resume builds a fresh snapshot");
    animations.push({ playState: "running", effect: new MotionEffect() });
    root.dispatchEvent(new Event("animationstart"));
    cache.snapshot();
    top = 83;
    assert.equal(cache.snapshot()?.rects.get(1)?.layerTop, 83, "moving bubbles remain accurate between invalidations");
    animations.length = 0;
    root.dispatchEvent(new Event("animationend"));
    cache.snapshot();
    const afterAnimation = reads;
    cache.snapshot();
    assert.equal(reads, afterAnimation, "finished animations must stop measuring every frame");
    row.dataset.messageId = "2";
    nodesChanged([{ type: "attributes", attributeName: "data-message-id" }]);
    assert.equal(cache.snapshot()?.rects.has(1), false);
    assert.equal(cache.snapshot()?.rects.has(2), true, "reused message rows cannot retain a previous message's collision");
  } finally {
    cache.stop();
    globals.forEach((key, index) => {
      const descriptor = originals[index];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    });
  }
});
