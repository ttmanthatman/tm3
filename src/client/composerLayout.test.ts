import assert from "node:assert/strict";
import test from "node:test";
import { composerHeightForContent } from "./composerLayout";

test("composer grows by content and stops at twelve rows", () => {
  assert.equal(composerHeightForContent(38), 38);
  assert.equal(composerHeightForContent(60), 60);
  assert.equal(composerHeightForContent(280), 280);
  assert.equal(composerHeightForContent(500), 280);
});
