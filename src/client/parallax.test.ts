import assert from "node:assert/strict";
import test from "node:test";
import { PARALLAX_KITS, cleanParallaxSpeed, parallaxAssetUrl, parallaxKit } from "./parallax";

test("rural parallax layers are ordered from stationary sky to fastest foreground", () => {
  const rural = parallaxKit("rural");
  assert.ok(rural);
  assert.equal(rural.layers.length, 10);
  assert.equal(rural.layers[0]?.id, "sky");
  assert.equal(rural.layers.at(-1)?.id, "river-front");
  assert.deepEqual(
    rural.layers.map((layer) => layer.depth),
    [...rural.layers].map((layer) => layer.depth).sort((a, b) => a - b)
  );
  assert.equal(PARALLAX_KITS.length, 1);
});

test("parallax speed is normalized to the supported range", () => {
  assert.equal(cleanParallaxSpeed(undefined), 1);
  assert.equal(cleanParallaxSpeed(0), 0.25);
  assert.equal(cleanParallaxSpeed(5), 3);
  assert.equal(cleanParallaxSpeed(1.236), 1.24);
});

test("parallax asset URLs encode kit and file segments", () => {
  assert.equal(parallaxAssetUrl("rural", "river front.png"), "/api/parallax/rural/river%20front.png");
});
