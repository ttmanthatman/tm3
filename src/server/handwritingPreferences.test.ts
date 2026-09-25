import assert from "node:assert/strict";
import test from "node:test";
import {
  HANDWRITING_DEFAULT_PREFERENCES,
  HANDWRITING_PRESET_COLORS
} from "../shared/handwriting.js";
import { cleanHandwritingPreferences, handwritingPreferencesJson } from "./handwritingPreferences.js";

test("handwriting account preferences are cleaned and serialized deterministically", () => {
  const cleaned = cleanHandwritingPreferences({
    strokeColors: ["#ABCDEF"],
    customColor: "#123456",
    selectedIndex: 7,
    paperEnabled: true,
    paperColor: "#F0E0D0",
    glowEnabled: true,
    glowColor: "#AABBCC",
    glowDensity: 72,
    glowWidth: 48,
    unexpected: true
  });
  assert.deepEqual(cleaned, {
    pen: "hard",
    brush: { ...HANDWRITING_DEFAULT_PREFERENCES.brush },
    strokeColors: ["#abcdef", ...HANDWRITING_PRESET_COLORS.slice(1)],
    customColor: "#123456",
    selectedIndex: 7,
    paperEnabled: true,
    paperColor: "#f0e0d0",
    glowEnabled: true,
    glowColor: "#aabbcc",
    glowDensity: 72,
    glowWidth: 48
  });
  assert.deepEqual(handwritingPreferencesJson(cleaned), cleaned);
  assert.deepEqual(cleanHandwritingPreferences(undefined), HANDWRITING_DEFAULT_PREFERENCES);
});

test("account brush preferences round-trip and invalid stored values recover safely", () => {
  const preferences = { pen: "brush", brush: { size: 55, sensitivity: 75, lag: 40 } };
  const clean = cleanHandwritingPreferences(handwritingPreferencesJson(preferences));
  assert.equal(clean.pen, "brush");
  assert.deepEqual(clean.brush, preferences.brush);
  assert.equal(cleanHandwritingPreferences({ pen: "unknown" }).pen, "hard");
  assert.deepEqual(cleanHandwritingPreferences({ brush: { size: -1, sensitivity: 101, lag: "bad" } }).brush, HANDWRITING_DEFAULT_PREFERENCES.brush);
});
