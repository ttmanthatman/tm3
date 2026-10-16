import assert from "node:assert/strict";
import test from "node:test";
import { readingSharePlant, readingShareWidth } from "./readingShareLayout";

test("shared passages expand from a compact measure to a bounded reading column", () => {
  const short = readingShareWidth("耶和华是我的牧者。");
  const medium = readingShareWidth("这是一段经文。".repeat(15));
  const long = readingShareWidth("这是一段经文。".repeat(1000));
  assert.ok(short >= 280 && short < medium);
  assert.ok(medium < long && long <= 520);
  assert.equal(readingShareWidth(""), readingShareWidth(" "));
  assert.equal(readingShareWidth("😊".repeat(100)), readingShareWidth("文".repeat(100)));
});

test("each message keeps its plant across renders while random send UUIDs spread across plants", () => {
  const seeds = ["c", "a", "b"];
  assert.deepEqual(seeds.map(readingSharePlant), ["flowers", "lavender", "fern"]);
  assert.deepEqual(["e86aa50d-efc3-4b1b-b99b-e5bd2db9c053", "5ba34ae8-79d0-4083-aa59-ab539549f315", 1234].map(readingSharePlant), ["lavender", "flowers", "lavender"]);
  assert.equal(readingSharePlant(1234), readingSharePlant("1234"));
  assert.equal(readingSharePlant(), "flowers");
});
