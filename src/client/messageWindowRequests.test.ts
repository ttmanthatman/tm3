import assert from "node:assert/strict";
import test from "node:test";
import {
  beginMessageWindowRequest,
  invalidateMessageWindowKind,
  invalidateMessageWindowRequests,
  isMessageWindowRequestCurrent
} from "./messageWindowRequests";

test("a newer request of the same kind supersedes the older one", () => {
  const stale = beginMessageWindowRequest("initial");
  const current = beginMessageWindowRequest("initial");
  assert.equal(isMessageWindowRequestCurrent(stale), false);
  assert.equal(isMessageWindowRequestCurrent(current), true);
});

test("requests of different kinds do not supersede each other", () => {
  const initial = beginMessageWindowRequest("initial");
  const prefetch = beginMessageWindowRequest("prefetch");
  assert.equal(isMessageWindowRequestCurrent(initial), true);
  assert.equal(isMessageWindowRequestCurrent(prefetch), true);
});

test("epoch invalidation revokes every in-flight ticket", () => {
  const ticket = beginMessageWindowRequest("older");
  invalidateMessageWindowRequests();
  assert.equal(isMessageWindowRequestCurrent(ticket), false);
  assert.equal(isMessageWindowRequestCurrent(beginMessageWindowRequest("older")), true);
});

test("kind invalidation revokes only that kind", () => {
  const prefetch = beginMessageWindowRequest("prefetch");
  const newer = beginMessageWindowRequest("newer");
  invalidateMessageWindowKind("prefetch");
  assert.equal(isMessageWindowRequestCurrent(prefetch), false);
  assert.equal(isMessageWindowRequestCurrent(newer), true);
});
