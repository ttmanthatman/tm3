import assert from "node:assert/strict";
import test from "node:test";
import { readingShareWidth } from "./readingShareLayout";

test("shared passages expand from a compact measure to a bounded reading column", () => {
  const short = readingShareWidth("耶和华是我的牧者。");
  const medium = readingShareWidth("这是一段经文。".repeat(15));
  const long = readingShareWidth("这是一段经文。".repeat(1000));
  assert.ok(short >= 280 && short < medium);
  assert.ok(medium < long && long <= 520);
  assert.equal(readingShareWidth(""), readingShareWidth(" "));
  assert.equal(readingShareWidth("😊".repeat(100)), readingShareWidth("文".repeat(100)));
});
