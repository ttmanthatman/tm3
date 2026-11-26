import assert from "node:assert/strict";
import test from "node:test";
import { receptionGuestDisplayName } from "./receptionGuestIdentity.js";

test("visitor numbers survive nickname edits and cannot be replaced by another visitor's number", () => {
  assert.equal(receptionGuestDisplayName("小明", 123), "小明 · 访客 #123");
  assert.equal(receptionGuestDisplayName("小明 · 访客 #123", 123), "小明 · 访客 #123");
  assert.equal(receptionGuestDisplayName("小明 · 访客 #999", 123), "小明 · 访客 #123");
  assert.equal(receptionGuestDisplayName(" · 访客 #999", 123), "来访者 · 访客 #123");
});

test("long visitor nicknames retain the complete number without splitting Unicode characters", () => {
  for (const name of ["长名字".repeat(40), "😀".repeat(40)]) {
    const result = receptionGuestDisplayName(name, 1234567890);
    assert.ok(result.length <= 80);
    assert.ok(result.endsWith(" · 访客 #1234567890"));
    assert.doesNotMatch(result, /\p{Surrogate}/u);
  }
});
