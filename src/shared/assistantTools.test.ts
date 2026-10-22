import assert from "node:assert/strict";
import test from "node:test";
import { assistantFeatureActions } from "./assistantTools.js";

test("feature cards accept only known entry points and bounded plain labels", () => {
  assert.deepEqual(assistantFeatureActions({ assistantActions: [{ feature: "delete_channel" }, { feature: "help", label: "  使用说明  " }] }), [{ feature: "help", label: "使用说明" }]);
  assert.deepEqual(assistantFeatureActions({ assistantActions: [{ feature: "books" }] }), [{ feature: "books", label: "图书室" }]);
  assert.deepEqual(assistantFeatureActions(null), []);
  assert.equal(assistantFeatureActions({ assistantActions: Array.from({ length: 20 }, () => ({ feature: "help", label: "x".repeat(100) })) }).length, 8);
  assert.equal(assistantFeatureActions({ assistantActions: [{ feature: "help", label: "x".repeat(100) }] })[0].label.length, 60);
});
