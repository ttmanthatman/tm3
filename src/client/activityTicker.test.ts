import assert from "node:assert/strict";
import test from "node:test";
import { activityTickerItems } from "./activityTicker";

test("activity ticker combines Bible, music, and typing presence", () => {
  assert.deepEqual(
    activityTickerItems(
      [
        { accountId: 1, displayName: "小恩", bookName: "创世记" },
        { accountId: 2, displayName: "小光", bookName: null }
      ],
      [{ accountId: 3, displayName: "小乐", trackId: 9, trackTitle: "奇异恩典" }],
      [{ displayName: "小平" }]
    ),
    [
      "小恩正在读《创世记》",
      "小光正在读圣经",
      "小乐正在听《奇异恩典》",
      "小平正在输入…"
    ]
  );
});
