import assert from "node:assert/strict";
import test from "node:test";
import { activityTickerItems } from "./activityTicker";

const empty = { bibleReaders: [], bibleListeners: [], bookReaders: [], musicListeners: [], friendListeners: [], typingActivities: [] };

test("activity ticker combines Bible reading/listening, book, music, friend, and typing presence", () => {
  assert.deepEqual(
    activityTickerItems({
      bibleReaders: [
        { accountId: 1, displayName: "小恩", bookName: "创世记" },
        { accountId: 2, displayName: "小光", bookName: null }
      ],
      bibleListeners: [{ accountId: 6, displayName: "小听", bookName: "诗篇", chapter: 23 }],
      bookReaders: [{ accountId: 5, displayName: "小书", bookTitle: "螺丝带信" }],
      musicListeners: [{ accountId: 3, displayName: "小乐", trackId: 9, trackTitle: "奇异恩典" }],
      friendListeners: [{ accountId: 4, displayName: "小友", programId: "195414", programTitle: "少忧虑，多祷告" }],
      typingActivities: [{ displayName: "小平" }, { displayName: "小安" }, { displayName: "小平" }]
    }),
    [
      "小恩正在读《创世记》",
      "小光正在读圣经",
      "小听正在听圣经《诗篇》23章",
      "小书正在读《螺丝带信》",
      "小乐正在听《奇异恩典》",
      "小友正在听良友节目《少忧虑，多祷告》",
      "小平、小安正在输入"
    ]
  );
});

test("a single typing user keeps the compact ellipsis treatment", () => {
  assert.deepEqual(activityTickerItems({ ...empty, typingActivities: [{ displayName: "小平" }] }), ["小平正在输入…"]);
});
