import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSavedReadPosition, shouldFollowMessageListChange } from "./readPosition";

test("normalizeSavedReadPosition rejects corrupt or stale pixel-only positions", () => {
  assert.equal(normalizeSavedReadPosition(null), null);
  assert.equal(normalizeSavedReadPosition({ messageId: 0, scrollTop: 320, savedAt: Date.now() }), null);
});

test("normalizeSavedReadPosition keeps semantic newest and message anchors", () => {
  assert.deepEqual(
    normalizeSavedReadPosition({ messageId: "__newest__", atBottom: true, scrollTop: 0, savedAt: 10 }),
    { messageId: "__newest__", offset: 0, atBottom: true, scrollTop: 0, savedAt: 10 }
  );
  assert.deepEqual(
    normalizeSavedReadPosition({ messageId: 42, offset: -12, atBottom: false, scrollTop: 900, savedAt: 20 }),
    { messageId: 42, offset: -12, atBottom: false, scrollTop: 900, savedAt: 20 }
  );
});

test("channel window replacement never triggers an automatic jump", () => {
  assert.equal(
    shouldFollowMessageListChange({ restoring: false, loadingOlder: false, previousLength: 120, length: 50, nearBottom: false, latestIsMine: false }),
    false
  );
});

test("new messages follow only when already near the bottom or sent locally", () => {
  assert.equal(
    shouldFollowMessageListChange({ restoring: false, loadingOlder: false, previousLength: 50, length: 51, nearBottom: true, latestIsMine: false }),
    true
  );
  assert.equal(
    shouldFollowMessageListChange({ restoring: false, loadingOlder: false, previousLength: 50, length: 51, nearBottom: false, latestIsMine: true }),
    true
  );
  assert.equal(
    shouldFollowMessageListChange({ restoring: true, loadingOlder: false, previousLength: 50, length: 51, nearBottom: true, latestIsMine: false }),
    false
  );
});
