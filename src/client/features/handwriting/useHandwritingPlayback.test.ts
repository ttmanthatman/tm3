import assert from "node:assert/strict";
import test from "node:test";
import type { HandwritingPayload } from "@shared/handwriting";
import { createHandwritingPlaybackController, handwritingGridMetrics, handwritingMessageEstimatedHeight } from "./useHandwritingPlayback.js";

const payload: HandwritingPayload = {
  kind: "handwriting",
  version: 1,
  characters: [{ strokes: [{ points: [[0, 0, 0], [10, 10, 20]] }] }]
};

function harness(overrides: Partial<Parameters<typeof createHandwritingPlaybackController>[0]> = {}) {
  let time = 0;
  let frameCallback: ((timestamp: number) => void) | null = null;
  let visibleCallback: ((visible: boolean) => void) | null = null;
  let documentVisible = true;
  let reduced = false;
  const draws: number[] = [];
  const states: boolean[] = [];
  const controller = createHandwritingPlaybackController({
    getPayload: () => payload,
    draw: (progress) => draws.push(progress),
    requestFrame: (callback) => { frameCallback = callback; return 1; },
    cancelFrame: () => { frameCallback = null; },
    now: () => time,
    isDocumentVisible: () => documentVisible,
    reducedMotion: () => reduced,
    observeVisibility: (_element, callback) => { visibleCallback = callback; return () => { visibleCallback = null; }; },
    onStateChange: (state) => states.push(state.playing),
    ...overrides
  });
  return {
    controller,
    draws,
    states,
    element: {} as Element,
    advance(ms: number) { time += ms; frameCallback?.(time); },
    setVisible(value: boolean) { visibleCallback?.(value); },
    setDocumentVisible(value: boolean) { documentVisible = value; },
    setReduced(value: boolean) { reduced = value; },
    hasFrame() { return !!frameCallback; }
  };
}

test("static mount has no frame loop and only an eligible real-time message can autoplay", () => {
  let claims = 0;
  const test = harness({ claimAutoPlay: () => { claims += 1; return claims === 1; } });
  test.controller.mount(test.element);
  assert.equal(test.hasFrame(), false);
  test.setVisible(true);
  assert.equal(test.hasFrame(), true);
  test.controller.destroy();
  assert.equal(test.hasFrame(), false);
});

test("offscreen and hidden states cancel frames and resume the same mount from progress", () => {
  const test = harness({ claimAutoPlay: () => false });
  test.controller.mount(test.element);
  test.setVisible(true);
  test.controller.play(true);
  test.advance(5);
  const progress = test.controller.state().progressMs;
  test.setVisible(false);
  assert.equal(test.hasFrame(), false);
  test.setVisible(true);
  assert.equal(test.hasFrame(), true);
  assert.equal(test.controller.state().progressMs, progress);
  test.controller.destroy();
});

test("manual replay starts once from zero and reduced motion blocks only automatic playback", () => {
  const test = harness({ claimAutoPlay: () => true });
  test.setReduced(true);
  test.controller.mount(test.element);
  test.setVisible(true);
  assert.equal(test.hasFrame(), false);
  assert.equal(test.controller.play(true), true);
  assert.equal(test.controller.state().progressMs, 0);
  test.controller.play(true);
  assert.equal(test.controller.state().playing, true);
  test.controller.destroy();
});

test("handwriting grid reserves complete rows and narrows columns on small screens", () => {
  assert.deepEqual(handwritingGridMetrics(payload, 1280), { columns: 1, rows: 1, count: 1, maxColumns: 6 });
  assert.deepEqual(handwritingGridMetrics(payload, 390), { columns: 1, rows: 1, count: 1, maxColumns: 6 });
  const seven = { ...payload, characters: Array.from({ length: 7 }, () => payload.characters[0]) };
  assert.deepEqual(handwritingGridMetrics(seven, 1280), { columns: 6, rows: 2, count: 7, maxColumns: 6 });
  assert.deepEqual(handwritingGridMetrics(seven, 390), { columns: 5, rows: 2, count: 7, maxColumns: 6 });
  assert.equal(handwritingMessageEstimatedHeight(seven, 1280) > handwritingMessageEstimatedHeight(payload, 1280), true);
});
