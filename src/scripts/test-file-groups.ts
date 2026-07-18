import fs from "node:fs";
import path from "node:path";

export const TEST_GROUPS = ["client", "server", "shared", "scripts", "service-worker"] as const;

export type TestGroup = (typeof TEST_GROUPS)[number];

export interface TestInventory {
  all: string[];
  byGroup: Record<TestGroup, string[]>;
  missing: string[];
  overlaps: Array<{ file: string; groups: TestGroup[] }>;
}

const TEST_FILE_PATTERN = /\.(?:test|spec)\.ts$/;
const SERVICE_WORKER_TEST = "src/scripts/service-worker.test.ts";

function toPosixPath(filePath: string) {
  return filePath.split(path.sep).join("/");
}

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return TEST_FILE_PATTERN.test(entry.name) ? [fullPath] : [];
  });
}

export function discoverTestFiles(root: string) {
  const sourceRoot = path.join(root, "src");
  return walk(sourceRoot)
    .map((filePath) => toPosixPath(path.relative(root, filePath)))
    .sort();
}

export function classifyTestFile(file: string): TestGroup[] {
  const normalized = toPosixPath(file);
  return TEST_GROUPS.filter((group) => {
    if (group === "client") return normalized.startsWith("src/client/");
    if (group === "server") return normalized.startsWith("src/server/");
    if (group === "shared") return normalized.startsWith("src/shared/");
    if (group === "service-worker") return normalized === SERVICE_WORKER_TEST;
    return normalized.startsWith("src/scripts/") && normalized !== SERVICE_WORKER_TEST;
  });
}

export function createTestInventory(root: string): TestInventory {
  const all = discoverTestFiles(root);
  const byGroup: Record<TestGroup, string[]> = {
    client: [],
    server: [],
    shared: [],
    scripts: [],
    "service-worker": []
  };
  const missing: string[] = [];
  const overlaps: Array<{ file: string; groups: TestGroup[] }> = [];

  for (const file of all) {
    const groups = classifyTestFile(file);
    if (groups.length === 0) missing.push(file);
    if (groups.length > 1) overlaps.push({ file, groups });
    for (const group of groups) byGroup[group].push(file);
  }

  return { all, byGroup, missing, overlaps };
}

export function assertValidTestInventory(inventory: TestInventory) {
  const problems: string[] = [];
  if (inventory.missing.length) {
    problems.push(`Unclassified test files:\n${inventory.missing.map((file) => `  - ${file}`).join("\n")}`);
  }
  if (inventory.overlaps.length) {
    problems.push(
      `Test files assigned to multiple groups:\n${inventory.overlaps
        .map(({ file, groups }) => `  - ${file}: ${groups.join(", ")}`)
        .join("\n")}`
    );
  }
  if (problems.length) throw new Error(problems.join("\n"));
}
