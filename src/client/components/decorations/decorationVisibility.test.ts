import assert from "node:assert/strict";
import test from "node:test";
import { observeDecorationVisibility } from "./decorationVisibility.js";

test("decoration pauses offscreen and on page exit, resumes, and releases observers/listeners", () => {
  const keys = ["document", "window", "IntersectionObserver"] as const;
  const originals = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  const documentEvents = new EventTarget();
  const windowEvents = new EventTarget();
  let state = "visible";
  let intersect!: (entries: { isIntersecting: boolean }[]) => void;
  let disconnected = false;
  let visible = false;
  let updates = 0;
  Object.defineProperty(documentEvents, "visibilityState", { get: () => state });
  class Observer {
    constructor(callback: typeof intersect) { intersect = callback; }
    observe() {}
    disconnect() { disconnected = true; }
  }
  [documentEvents, windowEvents, Observer].forEach((value, i) => {
    Object.defineProperty(globalThis, keys[i], { configurable: true, value });
  });
  try {
    const dispose = observeDecorationVisibility({} as Element, value => { visible = value; updates++; });
    assert.equal(visible, false);
    intersect([{ isIntersecting: true }]);
    assert.equal(visible, true);
    intersect([{ isIntersecting: false }]);
    assert.equal(visible, false);
    intersect([{ isIntersecting: true }]);
    state = "hidden";
    documentEvents.dispatchEvent(new Event("visibilitychange"));
    assert.equal(visible, false);
    state = "visible";
    documentEvents.dispatchEvent(new Event("visibilitychange"));
    assert.equal(visible, true);
    windowEvents.dispatchEvent(new Event("pagehide"));
    assert.equal(visible, false);
    documentEvents.dispatchEvent(new Event("visibilitychange"));
    assert.equal(visible, false);
    windowEvents.dispatchEvent(new Event("pageshow"));
    assert.equal(visible, true);
    dispose();
    assert.equal(disconnected, true);
    assert.equal(visible, false);
    const count = updates;
    windowEvents.dispatchEvent(new Event("pageshow"));
    documentEvents.dispatchEvent(new Event("visibilitychange"));
    assert.equal(updates, count);
  } finally {
    keys.forEach((key, i) => {
      const descriptor = originals[i];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
});
