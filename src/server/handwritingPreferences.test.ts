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
    unexpected: true
  });
  assert.deepEqual(cleaned, {
    strokeColors: ["#abcdef", ...HANDWRITING_PRESET_COLORS.slice(1)],
    customColor: "#123456",
    selectedIndex: 7,
    paperEnabled: true,
    paperColor: "#f0e0d0"
  });
  assert.deepEqual(handwritingPreferencesJson(cleaned), cleaned);
  assert.deepEqual(cleanHandwritingPreferences(undefined), HANDWRITING_DEFAULT_PREFERENCES);
});
