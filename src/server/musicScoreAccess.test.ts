import assert from "node:assert/strict";
import test from "node:test";
import { canReadMusicScore } from "./musicScoreAccess.js";

test("authenticated users can read scores attached to the shared music channel", () => {
  assert.equal(canReadMusicScore("music", false), true);
});

test("forwarded score pages still require access to their source chat channel", () => {
  assert.equal(canReadMusicScore("standard", false), false);
  assert.equal(canReadMusicScore("standard", true), true);
});
