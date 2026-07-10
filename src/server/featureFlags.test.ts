import assert from "node:assert/strict";
import test from "node:test";
import { envFlagEnabled } from "./featureFlags.js";

test("environment flags default to the supplied value", () => {
  assert.equal(envFlagEnabled(undefined), true);
  assert.equal(envFlagEnabled("", false), false);
});

test("environment flags recognize common disabled values", () => {
  for (const value of ["0", "false", "FALSE", "off", "no", "disabled"]) {
    assert.equal(envFlagEnabled(value), false, value);
  }
});

test("environment flags keep explicit enabled values enabled", () => {
  for (const value of ["1", "true", "on", "yes", "enabled"]) {
    assert.equal(envFlagEnabled(value), true, value);
  }
});
