import assert from "node:assert/strict";
import test from "node:test";
import { READING_SHARE_PLANTS, readingSharePlant, readingSharePlantImage, readingShareWidth } from "./readingShareLayout";

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
  assert.deepEqual(seeds.map(seed => readingSharePlant(seed)), ["daisy", "lavender", "fern"]);
  assert.equal(readingSharePlant(1234), readingSharePlant("1234"));
  assert.equal(readingSharePlant(), "cosmos");
  for (const kind of ["book", "bible"] as const) {
    assert.equal(new Set(READING_SHARE_PLANTS[kind]).size, 12);
    const plants = new Set(Array.from({ length: 120 }, (_, seed) => readingSharePlant(seed, kind)));
    assert.deepEqual([...plants].sort(), [...READING_SHARE_PLANTS[kind]].sort());
    assert.match(readingSharePlantImage(1234, kind), new RegExp(`${kind}-${readingSharePlant(1234, kind)}\\.webp$`));
  }
});
