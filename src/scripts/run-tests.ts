import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  assertValidTestInventory,
  createTestInventory,
  TEST_GROUPS,
  type TestGroup
} from "./test-file-groups.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
type TestSelection = TestGroup | "all";

function isTestSelection(value: string): value is TestSelection {
  return value === "all" || TEST_GROUPS.includes(value as TestGroup);
}

function printInventory() {
  const inventory = createTestInventory(ROOT);
  assertValidTestInventory(inventory);
  for (const group of TEST_GROUPS) {
    console.log(`${group} (${inventory.byGroup[group].length})`);
    for (const file of inventory.byGroup[group]) console.log(`  ${file}`);
  }
  console.log(`Test inventory valid: ${inventory.all.length} files, no overlaps or omissions.`);
}

export function runTests(selection: TestSelection) {
  const inventory = createTestInventory(ROOT);
  assertValidTestInventory(inventory);
  const tests = selection === "all" ? inventory.all : inventory.byGroup[selection];

  if (!tests.length) {
    console.error(`No test files found for ${selection}.`);
    return 1;
  }

  const counts = TEST_GROUPS.map((group) => `${group} ${inventory.byGroup[group].length}`).join(", ");
  console.log(selection === "all" ? `Running ${tests.length} test files (${counts}).` : `Running ${tests.length} ${selection} test files.`);

  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", "--test-reporter=dot", ...tests],
    { cwd: ROOT, stdio: "inherit" }
  );
  return result.status ?? 1;
}

function main() {
  const selection = process.argv[2] ?? "all";
  if (selection === "--list") {
    printInventory();
    return 0;
  }
  if (!isTestSelection(selection)) {
    console.error(`Unknown test group "${selection}". Expected one of: all, ${TEST_GROUPS.join(", ")}.`);
    return 1;
  }
  return runTests(selection);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
