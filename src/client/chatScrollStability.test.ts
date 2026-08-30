import assert from "node:assert/strict";
import test from "node:test";
import {
  createChatScrollIntentTracker,
  newestChatReadAnchor,
  shouldApplyChatReadAnchor
} from "./chatScrollStability.js";

test("a bottom scroll intent survives a later layout shift until scrolling becomes idle", () => {
  const tracker = createChatScrollIntentTracker();

  tracker.begin({ distanceFromBottom: 0, hasNewerMessages: false });

  assert.equal(tracker.shouldFollowNewestAfterIdle(), true);
  assert.equal(tracker.shouldFollowNewestAfterIdle(), false);
});

test("actual scrolling away from newest cancels the captured bottom intent", () => {
  const tracker = createChatScrollIntentTracker();

  tracker.begin({ distanceFromBottom: 0, hasNewerMessages: false });
  tracker.noteScroll({ distanceFromBottom: 480, hasNewerMessages: false });

  assert.equal(tracker.shouldFollowNewestAfterIdle(), false);
});

test("scrolling down to newest promotes the idle state to follow future layout changes", () => {
  const tracker = createChatScrollIntentTracker();

  tracker.begin({ distanceFromBottom: 900, hasNewerMessages: false });
  tracker.noteScroll({ distanceFromBottom: 0, hasNewerMessages: false });

  assert.equal(tracker.shouldFollowNewestAfterIdle(), true);
});

test("newer unloaded messages prevent a pixel-bottom viewport from following", () => {
  const tracker = createChatScrollIntentTracker();

  tracker.begin({ distanceFromBottom: 0, hasNewerMessages: true });

  assert.equal(tracker.shouldFollowNewestAfterIdle(), false);
});

test("a queued anchor correction is invalid after the anchor is cancelled or replaced", () => {
  const scheduled = {
    kind: "message" as const,
    messageId: 42,
    offset: 80,
    expiresAt: 2_000,
    token: 7
  };

  assert.equal(shouldApplyChatReadAnchor(scheduled, scheduled, 7, 1_000), true);
  assert.equal(shouldApplyChatReadAnchor(scheduled, null, 7, 1_000), false);
  assert.equal(shouldApplyChatReadAnchor(scheduled, newestChatReadAnchor(7), 7, 1_000), false);
  assert.equal(shouldApplyChatReadAnchor(scheduled, scheduled, 8, 1_000), false);
  assert.equal(shouldApplyChatReadAnchor(scheduled, scheduled, 7, 2_001), false);
});
