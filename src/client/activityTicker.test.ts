import assert from "node:assert/strict";
import test from "node:test";
import { activityTickerItems, advanceActivityTickerPosition } from "./activityTicker";

test("activity ticker combines Bible, book, music, friend, and typing presence", () => {
  assert.deepEqual(
    activityTickerItems(
      [
        { accountId: 1, displayName: "小恩", bookName: "创世记" },
        { accountId: 2, displayName: "小光", bookName: null }
      ],
      [{ accountId: 5, displayName: "小书", bookTitle: "螺丝带信" }],
      [{ accountId: 3, displayName: "小乐", trackId: 9, trackTitle: "奇异恩典" }],
      [{ accountId: 4, displayName: "小友", programId: "195414", programTitle: "少忧虑，多祷告" }],
      [{ displayName: "小平" }, { displayName: "小安" }, { displayName: "小平" }]
    ),
    [
      "小恩正在读《创世记》",
      "小光正在读圣经",
      "小书正在读《螺丝带信》",
      "小乐正在听《奇异恩典》",
      "小友正在听良友节目《少忧虑，多祷告》",
      "小平、小安正在输入"
    ]
  );
});

test("a single typing user keeps the compact ellipsis treatment", () => {
  assert.deepEqual(activityTickerItems([], [], [], [], [{ displayName: "小平" }]), ["小平正在输入…"]);
});

test("activity ticker moves at a stable pixel speed and only resets after all text exits", () => {
  assert.equal(advanceActivityTickerPosition(200, 1_000, 500, 320), 164);
  assert.equal(advanceActivityTickerPosition(-499, 1_000, 500, 320), 320);
  assert.equal(advanceActivityTickerPosition(-250, 100, 200, 320), 320);
});
