import assert from "node:assert/strict";
import test from "node:test";
import { cleanSupportedMessageEffect, SUPPORTED_MESSAGE_EFFECTS } from "./messageEffects.js";

test("accepts the locally interactive oops effect in message payloads", () => {
  assert.equal(cleanSupportedMessageEffect("oops"), "oops");
  assert.ok(SUPPORTED_MESSAGE_EFFECTS.includes("oops"));
});

test("rejects removed, unknown, and non-string message effects", () => {
  assert.equal(cleanSupportedMessageEffect("water"), undefined);
  assert.equal(cleanSupportedMessageEffect("unknown"), undefined);
  assert.equal(cleanSupportedMessageEffect({ effect: "oops" }), undefined);
});
