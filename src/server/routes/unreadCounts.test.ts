import assert from "node:assert/strict";
import test from "node:test";
import { parseLastReadMap } from "./unreadCounts.js";

test("parseLastReadMap accepts a plain channel-to-message id map", () => {
  assert.deepEqual(parseLastReadMap('{"3":123,"5":0}'), { 3: 123, 5: 0 });
});

test("parseLastReadMap drops malformed keys and values", () => {
  assert.deepEqual(parseLastReadMap('{"0":5,"abc":9,"4":"12","6":-3,"7":1.9}'), { 4: 12, 7: 1 });
});

test("parseLastReadMap treats invalid JSON and non-objects as empty", () => {
  assert.deepEqual(parseLastReadMap("not-json"), {});
  assert.deepEqual(parseLastReadMap("[1,2]"), {});
  assert.deepEqual(parseLastReadMap("null"), {});
  assert.deepEqual(parseLastReadMap(""), {});
});
