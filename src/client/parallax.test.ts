import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PARALLAX_KITS, cleanParallaxKits, cleanParallaxSpeed, parallaxAssetUrl, parallaxKit } from "./parallax";

test("rural parallax keeps the official back-to-front order and cloud reflection speed", () => {
  const kits = cleanParallaxKits(DEFAULT_PARALLAX_KITS);
  const rural = parallaxKit(kits, "rural");
  assert.ok(rural);
  assert.equal(rural.layers.length, 10);
  assert.equal(rural.layers[0]?.id, "sky");
  assert.equal(rural.layers.at(-1)?.id, "river-front");
  assert.equal(rural.layers.find((layer) => layer.id === "river-reflection")?.speed, rural.layers.find((layer) => layer.id === "clouds")?.speed);
  assert.equal(kits.length, 1);
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

test("custom parallax kit layers keep order and clamp editable values", () => {
  const kits = cleanParallaxKits([
    ...DEFAULT_PARALLAX_KITS,
    {
      id: "custom-river",
      name: "River",
      layers: [
        { id: "back", name: "Back", file: "back.png", speed: -1, yOffset: -900, heightScale: 0.1 },
        { id: "front", name: "Front", file: "front.png", speed: 9, yOffset: 900, heightScale: 8 }
      ]
    }
  ]);
  const custom = parallaxKit(kits, "custom-river");
  assert.ok(custom);
  assert.deepEqual(custom.layers.map((layer) => layer.id), ["back", "front"]);
  assert.deepEqual(custom.layers.map((layer) => [layer.speed, layer.yOffset, layer.heightScale]), [[0, -600, 0.25], [3, 600, 4]]);
});
