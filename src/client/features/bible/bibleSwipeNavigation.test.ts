import assert from "node:assert/strict";
import test from "node:test";
import { createBibleSwipeNavigation } from "./bibleSwipeNavigation";

function harness(direction: "left" | "right" = "right") {
  const appearance = { bibleSwipeEnabled: true, bibleSwipeProtectInteractions: true };
  let blocked = false;
  let navigations = 0;
  const handlers = createBibleSwipeNavigation({ appearance: () => appearance, blocked: () => blocked, direction, navigate: () => navigations++ });
  function event(x: number, y = 100, kind: "plain" | "control" | "interaction" | "excluded" = "plain", ending = false, count = 1) {
    const target = { closest: (selector: string) => {
      if (selector === "[data-bible-swipe-interaction]") return kind === "interaction" ? target : null;
      if (selector === "[data-no-bible-swipe]") return kind === "excluded" ? target : null;
      return kind === "control" || kind === "interaction" ? target : null;
    } };
    const touches = Array.from({ length: count }, () => ({ clientX: x, clientY: y }));
    return { target, touches: ending ? [] : touches, changedTouches: ending ? touches : [] } as unknown as TouchEvent;
  }
  return { ...handlers, appearance, event, navigations: () => navigations, block: () => { blocked = true; } };
}

test("both directions keep normal swipes and ignore vertical, small, edge and control gestures", () => {
  for (const direction of ["left", "right"] as const) {
    const h = harness(direction);
    const destination = direction === "right" ? 280 : 60;
    h.start(h.event(160)); h.end(h.event(destination, 100, "plain", true));
    assert.equal(h.navigations(), 1);
    for (const [startX, endX, endY, kind] of [[160, 175, 100, "plain"], [160, destination, 250, "plain"], [10, destination, 100, "plain"], [160, destination, 100, "control"], [160, destination, 100, "excluded"]] as const) {
      h.start(h.event(startX, 100, kind)); h.end(h.event(endX, endY, kind, true));
    }
    assert.equal(h.navigations(), 1);
  }
});

test("the global switch disables both directions and clears a pending gesture", () => {
  for (const direction of ["left", "right"] as const) {
    const h = harness(direction);
    h.start(h.event(160));
    h.appearance.bibleSwipeEnabled = false;
    h.end(h.event(direction === "right" ? 280 : 60, 100, "plain", true));
    h.start(h.event(160));
    h.appearance.bibleSwipeEnabled = true;
    h.end(h.event(direction === "right" ? 280 : 60, 100, "plain", true));
    assert.equal(h.navigations(), 0);
  }
});

test("writing and playback surfaces are protected independently of normal navigation", () => {
  for (const direction of ["left", "right"] as const) {
    const h = harness(direction);
    const end = () => h.end(h.event(direction === "right" ? 280 : 60, 100, "interaction", true));
    h.start(h.event(160, 100, "interaction")); end();
    assert.equal(h.navigations(), 0);
    h.appearance.bibleSwipeProtectInteractions = false;
    h.start(h.event(160, 100, "interaction")); end();
    assert.equal(h.navigations(), 1);
    h.start(h.event(160, 100, "interaction"));
    h.appearance.bibleSwipeProtectInteractions = true;
    end();
    assert.equal(h.navigations(), 1);
  }
});

test("cancelled, multitouch and blocked gestures never leave stale navigation", () => {
  const h = harness();
  h.start(h.event(160)); h.cancel(); h.end(h.event(280, 100, "plain", true));
  h.start(h.event(160, 100, "plain", false, 2)); h.end(h.event(280, 100, "plain", true));
  h.start(h.event(160)); h.start(h.event(160, 100, "control")); h.end(h.event(280, 100, "control", true));
  h.start(h.event(160)); h.block(); h.end(h.event(280, 100, "plain", true));
  assert.equal(h.navigations(), 0);
});
