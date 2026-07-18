import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertValidTestInventory,
  classifyTestFile,
  createTestInventory,
  TEST_GROUPS
} from "./test-file-groups.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("every source test file belongs to exactly one test group", () => {
  const inventory = createTestInventory(ROOT);
  assert.doesNotThrow(() => assertValidTestInventory(inventory));

  const groupedFiles = TEST_GROUPS.flatMap((group) => inventory.byGroup[group]).sort();
  assert.deepEqual(groupedFiles, inventory.all);
  assert.equal(new Set(groupedFiles).size, inventory.all.length);
});

test("service worker tests stay separate from general script tests", () => {
  assert.deepEqual(classifyTestFile("src/scripts/service-worker.test.ts"), ["service-worker"]);
  assert.deepEqual(classifyTestFile("src/scripts/check-public-tree.test.ts"), ["scripts"]);
});
