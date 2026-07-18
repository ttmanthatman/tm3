import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface PublicTreeViolation {
  file: string;
  category: string;
  line?: number;
}

interface ContentRule {
  category: string;
  pattern: RegExp;
  allowInGitignore?: boolean;
}

const FORBIDDEN_DIRECTORY_CATEGORIES = new Map<string, string>([
  ["node_modules", "dependency directory"],
  ["storage", "runtime data directory"],
  ["output", "generated output directory"],
  [".codex", "local Codex artifact directory"],
  ["artifacts", "temporary artifact directory"],
  ["test-results", "test result directory"],
  ["playwright-report", "Playwright report directory"],
  ["blob-report", "browser blob report directory"]
]);

const FORBIDDEN_FILENAME_CATEGORIES = new Map<string, string>([
  ["AGENTS.local.md", "local agent guidance"],
  [".DS_Store", "operating-system metadata"]
]);

const BUILT_IN_CONTENT_RULES: ContentRule[] = [
  {
    category: "macOS user directory path",
    pattern: /(?<![A-Za-z0-9_:/])\/Users\/(?!<)[A-Za-z0-9._-]+\/[^\s"'`)<>\]]+/m
  },
  {
    category: "Linux user directory path",
    pattern: /(?<![A-Za-z0-9_:/])\/home\/(?!<)[A-Za-z0-9._-]+\/[^\s"'`)<>\]]+/m
  },
  {
    category: "Windows absolute path",
    pattern: /(?:^|[\s"'`(=])(?:[A-Za-z]:[\\/])(?!<)[^\s"'`)<>\]]+/m
  },
  {
    category: "Codex visualization path",
    pattern: /(?:^|[\s"'`(=\\/])\.codex[\\/]visualizations(?:[\\/]|$)/m,
    allowInGitignore: true
  },
  {
    category: "temporary QA report path",
    pattern: /(?:^|[\s"'`(=\\/])(?:playwright-report|test-results|blob-report)(?:[\\/]|$)/m,
    allowInGitignore: true
  },
  {
    category: "local temporary file path",
    pattern: /(?<![A-Za-z0-9_:/])\/(?:private\/var\/folders|tmp)\/(?!<)[^\s"'`)<>\]]+/m
  },
  {
    category: "local file URI",
    pattern: /file:\/\/\/(?:Users|home|tmp|private\/var\/folders)\/(?!<)[^\s"'`)<>\]]+/m
  }
];

function gitLsFiles() {
  const result = spawnSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "git ls-files failed");
  }
  return result.stdout.split("\0").filter(Boolean);
}

export function trackedPathViolation(file: string): PublicTreeViolation | null {
  const normalized = file.replaceAll("\\", "/");
  const segments = normalized.split("/");
  const filename = segments.at(-1) || normalized;

  if (filename !== ".env.example" && (filename === ".env" || filename.startsWith(".env."))) {
    return { file, category: "tracked environment file" };
  }

  const forbiddenFilenameCategory = FORBIDDEN_FILENAME_CATEGORIES.get(filename);
  if (forbiddenFilenameCategory) {
    return { file, category: forbiddenFilenameCategory };
  }

  for (const segment of segments.slice(0, -1)) {
    const category = FORBIDDEN_DIRECTORY_CATEGORIES.get(segment);
    if (category) return { file, category };
  }

  return null;
}

export function additionalContentRules(value = ""): ContentRule[] {
  return value
    .split(/\r?\n|,/)
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .map((pattern) => ({
      category: "additional forbidden pattern",
      pattern: new RegExp(pattern, "i")
    }));
}

function lineNumberAt(text: string, index: number) {
  let line = 1;
  for (let offset = 0; offset < index; offset += 1) {
    if (text.charCodeAt(offset) === 10) line += 1;
  }
  return line;
}

export function contentViolations(
  file: string,
  text: string,
  additionalRules: ContentRule[] = []
): PublicTreeViolation[] {
  const violations: PublicTreeViolation[] = [];
  const isGitignore = path.posix.basename(file.replaceAll("\\", "/")) === ".gitignore";

  for (const rule of [...BUILT_IN_CONTENT_RULES, ...additionalRules]) {
    if (isGitignore && rule.allowInGitignore) continue;
    rule.pattern.lastIndex = 0;
    const match = rule.pattern.exec(text);
    if (!match) continue;
    violations.push({
      file,
      category: rule.category,
      line: lineNumberAt(text, match.index)
    });
  }

  return violations;
}

export function textFromBuffer(content: Buffer): string | null {
  if (content.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    return null;
  }
}

export function formatViolation(violation: PublicTreeViolation) {
  const location = violation.line ? `${violation.file}:${violation.line}` : violation.file;
  return `${location} [${violation.category}]`;
}

export function runPublicTreeCheck(
  files = gitLsFiles(),
  additionalPatterns = process.env.PUBLIC_SAFETY_FORBIDDEN_PATTERNS || ""
) {
  const violations = files.flatMap((file) => {
    const pathViolation = trackedPathViolation(file);
    return pathViolation ? [pathViolation] : [];
  });
  const rules = additionalContentRules(additionalPatterns);

  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const text = textFromBuffer(fs.readFileSync(file));
    if (text === null) continue;
    violations.push(...contentViolations(file, text, rules));
  }

  return violations;
}

function main() {
  const files = gitLsFiles();
  let violations: PublicTreeViolation[];

  try {
    violations = runPublicTreeCheck(files);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Public tree safety check failed: [additional forbidden pattern configuration] ${message}`);
    process.exit(1);
  }

  if (violations.length) {
    console.error("Public tree safety check failed:");
    for (const violation of violations) console.error(`- ${formatViolation(violation)}`);
    process.exit(1);
  }

  console.log(`Public tree safety check passed (${files.length} tracked files).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
