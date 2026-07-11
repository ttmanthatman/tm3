import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const SOURCE_ROOT = path.join(ROOT, "src");

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return /\.(test|spec)\.ts$/.test(entry.name) ? [fullPath] : [];
  });
}

const tests = walk(SOURCE_ROOT).sort();

if (!tests.length) {
  console.log("No logic tests found under src/**/*.test.ts or src/**/*.spec.ts.");
  process.exit(0);
}

const result = spawnSync("node", ["--import", "tsx", "--test", ...tests], { stdio: "inherit" });
process.exit(result.status ?? 1);
