import { spawnSync } from "node:child_process";
import fs from "node:fs";

const FORBIDDEN_TRACKED_PATHS = ["AGENTS.md", ".env", "storage", "node_modules"];

function gitLsFiles() {
  const result = spawnSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "git ls-files failed");
  }
  return result.stdout.split("\0").filter(Boolean);
}

function isForbiddenPath(file: string) {
  return FORBIDDEN_TRACKED_PATHS.some((forbidden) => file === forbidden || file.startsWith(`${forbidden}/`));
}

function forbiddenContentPatterns() {
  return (process.env.PUBLIC_SAFETY_FORBIDDEN_PATTERNS || "")
    .split(/\r?\n|,/)
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .map((pattern) => new RegExp(pattern, "i"));
}

function main() {
  const files = gitLsFiles();
  const blockedFiles = files.filter(isForbiddenPath);
  const patterns = forbiddenContentPatterns();
  const contentHits: string[] = [];

  for (const file of files) {
    if (!patterns.length || !fs.existsSync(file)) continue;
    const content = fs.readFileSync(file);
    if (content.includes(0)) continue;
    const text = content.toString("utf8");
    for (const pattern of patterns) {
      if (pattern.test(text)) contentHits.push(`${file} matches /${pattern.source}/i`);
    }
  }

  const failures = [...blockedFiles.map((file) => `${file} is tracked`), ...contentHits];
  if (failures.length) {
    console.error("Public tree safety check failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log(`Public tree safety check passed (${files.length} tracked files).`);
}

main();
