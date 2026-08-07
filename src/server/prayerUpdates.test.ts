import assert from "node:assert/strict";
import test from "node:test";
import { PRAYER_UPDATE_HISTORY_LIMIT, prependPrayerUpdateHistory } from "./prayerUpdates.js";

test("first update moves the replaced content to the front of an empty history", () => {
  const updates = prependPrayerUpdateHistory({}, "原文内容", "2026-08-01T00:00:00.000Z", "alice");
  assert.deepEqual(updates, [{ content: "原文内容", at: "2026-08-01T00:00:00.000Z", by: "alice" }]);
});

test("newest replaced content stays first and older entries shift down", () => {
  const raw = {
    updates: [{ content: "第一次动态", at: "2026-08-02T00:00:00.000Z", by: "alice" }]
  };
  const updates = prependPrayerUpdateHistory(raw, "第二次动态", "2026-08-03T00:00:00.000Z", "bob");
  assert.deepEqual(updates, [
    { content: "第二次动态", at: "2026-08-03T00:00:00.000Z", by: "bob" },
    { content: "第一次动态", at: "2026-08-02T00:00:00.000Z", by: "alice" }
  ]);
});

test("missing updater name is omitted", () => {
  const updates = prependPrayerUpdateHistory({}, "原文内容", "2026-08-01T00:00:00.000Z");
  assert.deepEqual(updates, [{ content: "原文内容", at: "2026-08-01T00:00:00.000Z" }]);
});

test("replaced photo rides into the history entry", () => {
  const updates = prependPrayerUpdateHistory({}, "带图内容", "2026-08-01T00:00:00.000Z", "alice", 42);
  assert.deepEqual(updates, [{ content: "带图内容", at: "2026-08-01T00:00:00.000Z", by: "alice", imageMessageId: 42 }]);
});

test("stored entries keep a valid imageMessageId and drop invalid ones", () => {
  const raw = {
    updates: [
      { content: "有图", at: "2026-08-02T00:00:00.000Z", imageMessageId: 7 },
      { content: "坏图", at: "2026-08-02T00:00:00.000Z", imageMessageId: -3 }
    ]
  };
  const updates = prependPrayerUpdateHistory(raw, "新内容", "2026-08-03T00:00:00.000Z");
  assert.deepEqual(updates, [
    { content: "新内容", at: "2026-08-03T00:00:00.000Z" },
    { content: "有图", at: "2026-08-02T00:00:00.000Z", imageMessageId: 7 },
    { content: "坏图", at: "2026-08-02T00:00:00.000Z" }
  ]);
});

test("malformed stored entries are dropped", () => {
  const raw = {
    updates: [
      { content: "有效条目", at: "2026-08-02T00:00:00.000Z" },
      null,
      "junk",
      { at: "2026-08-02T00:00:00.000Z" },
      { content: "", at: "2026-08-02T00:00:00.000Z" }
    ]
  };
  const updates = prependPrayerUpdateHistory(raw, "新内容", "2026-08-03T00:00:00.000Z", "alice");
  assert.deepEqual(updates, [
    { content: "新内容", at: "2026-08-03T00:00:00.000Z", by: "alice" },
    { content: "有效条目", at: "2026-08-02T00:00:00.000Z" }
  ]);
});

test("history is capped at the limit with the oldest entries dropped", () => {
  const raw = {
    updates: Array.from({ length: PRAYER_UPDATE_HISTORY_LIMIT }, (_, index) => ({
      content: `旧条目 ${index}`,
      at: "2026-08-01T00:00:00.000Z"
    }))
  };
  const updates = prependPrayerUpdateHistory(raw, "新内容", "2026-08-03T00:00:00.000Z", "alice");
  assert.equal(updates.length, PRAYER_UPDATE_HISTORY_LIMIT);
  assert.equal(updates[0]?.content, "新内容");
  assert.equal(updates.at(-1)?.content, `旧条目 ${PRAYER_UPDATE_HISTORY_LIMIT - 2}`);
});
