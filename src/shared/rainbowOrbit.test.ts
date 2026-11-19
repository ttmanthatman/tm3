import assert from "node:assert/strict";
import test from "node:test";
import { cleanRainbowOrbit, rainbowSamples, DEFAULT_RAINBOW_COLORS } from "./rainbowOrbit.js";

test("rainbow defaults, independent widths and palette limits", () => {
  assert.deepEqual(cleanRainbowOrbit(), { innerWidth: 10, outerWidth: 18, colors: DEFAULT_RAINBOW_COLORS });
  assert.deepEqual(cleanRainbowOrbit({ innerWidth: -1, outerWidth: 90, colors: ["bad", "#123456"] }), { innerWidth: 0, outerWidth: 40, colors: ["#123456"] });
  assert.equal(cleanRainbowOrbit({ colors: Array(100).fill("#ffffff") }).colors.length, 99);
  assert.deepEqual(cleanRainbowOrbit({ colors: [] }).colors, DEFAULT_RAINBOW_COLORS);
  const copy = cleanRainbowOrbit(); copy.colors.pop();
  assert.equal(cleanRainbowOrbit().colors.length, 6);
});
test("palette order and cyclic seam interpolate without a jump", () => {
  const sample = rainbowSamples(cleanRainbowOrbit({ colors: ["#ff0000", "#0000ff"] }));
  assert.equal(sample[0], "rgb(255 0 0)");
  assert.equal(sample[30], "rgb(128 0 128)");
  assert.equal(sample[60], "rgb(0 0 255)");
  assert.equal(sample[119], "rgb(251 0 4)");
  assert.deepEqual(new Set(rainbowSamples(cleanRainbowOrbit({ colors: ["#123456"] }))), new Set(["rgb(18 52 86)"]));
  assert.equal(rainbowSamples(cleanRainbowOrbit({ colors: Array(99).fill("#ffffff") })).length, 396);
});
