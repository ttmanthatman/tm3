import assert from "node:assert/strict";
import test from "node:test";
import { activityLogCategory, friendlyDeviceName, shouldWriteMusicProgress } from "./activityLog.js";

test("generic browser platform names become useful device names", () => {
  assert.equal(friendlyDeviceName("MacIntel", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"), "Mac");
  assert.equal(friendlyDeviceName("MacIntel", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5), "iPad");
  assert.equal(friendlyDeviceName("Win32", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "Windows");
  assert.equal(friendlyDeviceName("小明的电脑", "Mozilla/5.0 (Macintosh)"), "小明的电脑");
});

test("music progress snapshots are throttled while lifecycle events are always kept", () => {
  assert.equal(shouldWriteMusicProgress("progress", 4_999), false);
  assert.equal(shouldWriteMusicProgress("progress", 5_000), true);
  assert.equal(shouldWriteMusicProgress("started", 0), true);
  assert.equal(shouldWriteMusicProgress("paused", 0), true);
  assert.equal(shouldWriteMusicProgress("changed", 0), true);
  assert.equal(shouldWriteMusicProgress("ended", 0), true);
});

test("activity log kinds map to the log page filters", () => {
  assert.equal(activityLogCategory("auth_login"), "session");
  assert.equal(activityLogCategory("presence_leave"), "session");
  assert.equal(activityLogCategory("music_progress"), "music");
  assert.equal(activityLogCategory("channel_view"), "usage");
  assert.equal(activityLogCategory("message_sent"), "usage");
});
