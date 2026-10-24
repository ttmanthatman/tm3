import assert from "node:assert/strict";
import test from "node:test";
import { ZOOM_END_REPLIES, explorationDateLabel, explorationToday, previousExplorationDay } from "./zoomEndEgg";

test("the Zoom end egg keeps the requested reply order before today's date", () => {
  assert.deepEqual([...ZOOM_END_REPLIES], ["Zoom会议结束了", "确实结束了", "真的别点了", "你要信", "想参加吗？", "下次吧……", "别试了真没了"]);
  assert.equal(explorationDateLabel(explorationToday(new Date(2026, 9, 24))), "2026年10月24日");
});

test("calendar countdown crosses month, year and leap-day boundaries", () => {
  for (const [year, month, day, expected] of [
    [2026, 10, 24, "2026年10月23日"], [2026, 1, 1, "2025年12月31日"],
    [2024, 3, 1, "2024年2月29日"], [2024, 2, 29, "2024年2月28日"],
    [1900, 3, 1, "1900年2月28日"], [2000, 3, 1, "2000年2月29日"]
  ] as const) {
    assert.equal(explorationDateLabel(previousExplorationDay({ year: BigInt(year), month, day })), expected);
  }
});

test("countdown continues before the common era and beyond JavaScript Date's minimum", () => {
  assert.equal(explorationDateLabel(previousExplorationDay({ year: 1n, month: 1, day: 1 })), "公元前1年12月31日");
  let date = { year: -9007199254740993n, month: 1, day: 1 };
  for (let index = 0; index < 10_000; index++) date = previousExplorationDay(date);
  assert.ok(date.year < -9007199254740993n);
  assert.ok(!explorationDateLabel(date).includes("NaN"));
});
