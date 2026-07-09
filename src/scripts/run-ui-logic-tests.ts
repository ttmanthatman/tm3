import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const CLIENT_ROOT = path.join(ROOT, "src/client");

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return /\.(test|spec)\.ts$/.test(entry.name) ? [fullPath] : [];
  });
}

const tests = walk(CLIENT_ROOT).sort();

if (!tests.length) {
  console.log("No UI logic tests found under src/client/**/*.test.ts or src/client/**/*.spec.ts.");
  process.exit(0);
}

const result = spawnSync("node", ["--import", "tsx", "--test", ...tests], { stdio: "inherit" });
process.exit(result.status ?? 1);
