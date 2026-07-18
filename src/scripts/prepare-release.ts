import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkReleaseConsistency,
  formatReleaseViolation,
  parseReleaseMetadata,
  readUnreleasedSection,
  type ReleaseFileOverrides
} from "./check-release-consistency.js";

const MANAGED_FILES = [
  "package.json",
  "package-lock.json",
  "src/shared/release.ts",
  "CHANGELOG.md"
] as const;

interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: Array<number | string>;
}

export interface PrepareReleaseOptions {
  root?: string;
  dryRun?: boolean;
  date?: string;
  runCheckRelease?: boolean;
}

export interface PrepareReleaseResult {
  currentVersion: string;
  targetVersion: string;
  date: string;
  notes: string[];
  dryRun: boolean;
}

function parseSemVer(value: string): SemVer | null {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/.exec(
      value
    );
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]
      ? match[4].split(".").map((identifier) => (/^\d+$/.test(identifier) ? Number(identifier) : identifier))
      : []
  };
}

export function compareSemVer(leftValue: string, rightValue: string) {
  const left = parseSemVer(leftValue);
  const right = parseSemVer(rightValue);
  if (!left || !right) throw new Error(`cannot compare invalid SemVer values: ${leftValue}, ${rightValue}`);

  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  if (!left.prerelease.length && !right.prerelease.length) return 0;
  if (!left.prerelease.length) return 1;
  if (!right.prerelease.length) return -1;

  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    if (typeof leftPart === "number" && typeof rightPart === "string") return -1;
    if (typeof leftPart === "string" && typeof rightPart === "number") return 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

function localDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function gitStatus(root: string) {
  return execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: root,
    encoding: "utf8"
  }).trim();
}

function formattedNotes(notes: string[]) {
  return `[\n${notes.map((note) => `  ${JSON.stringify(note)}`).join(",\n")}\n] as const;`;
}

function updatePackagePreviews(
  packageSource: string,
  lockSource: string,
  targetVersion: string
): Pick<ReleaseFileOverrides, "package.json" | "package-lock.json"> {
  const packageJson = JSON.parse(packageSource);
  const packageLock = JSON.parse(lockSource);
  packageJson.version = targetVersion;
  packageLock.version = targetVersion;
  if (!packageLock.packages?.[""]) throw new Error("package-lock.json is missing packages[\"\"]");
  packageLock.packages[""].version = targetVersion;
  return {
    "package.json": `${JSON.stringify(packageJson, null, 2)}\n`,
    "package-lock.json": `${JSON.stringify(packageLock, null, 2)}\n`
  };
}

function updateReleaseSource(source: string, targetVersion: string, date: string, notes: string[]) {
  const current = parseReleaseMetadata(source);
  const notesMatch = /^export const RELEASE_NOTES = (\[\n[\s\S]*?\n\] as const);$/m.exec(source);
  if (!notesMatch) throw new Error("src/shared/release.ts: could not isolate RELEASE_NOTES");

  const archivedName = `RELEASE_${current.version.replace(/[^0-9a-zA-Z]+/g, "_")}_NOTES`;
  if (source.includes(`const ${archivedName} =`)) {
    throw new Error(`src/shared/release.ts: ${archivedName} already exists`);
  }

  let updated = source
    .replace(
      /^export const APP_VERSION = "[^"]+";$/m,
      `export const APP_VERSION = ${JSON.stringify(targetVersion)};`
    )
    .replace(/^export const RELEASE_DATE = "[^"]+";$/m, `export const RELEASE_DATE = ${JSON.stringify(date)};`)
    .replace(
      notesMatch[0],
      `export const RELEASE_NOTES = ${formattedNotes(notes)}\n\nconst ${archivedName} = ${notesMatch[1]}`
    );

  const firstHistoryEntry =
    /export const RELEASE_HISTORY = \[\n  \{\n    version: "([^"]+)",\n    date: "([^"]+)",\n    notes: RELEASE_NOTES\n  \},/;
  const historyMatch = firstHistoryEntry.exec(updated);
  if (!historyMatch || historyMatch[1] !== current.version || historyMatch[2] !== current.date) {
    throw new Error("src/shared/release.ts: latest RELEASE_HISTORY entry is not the current release");
  }
  updated = updated.replace(
    firstHistoryEntry,
    `export const RELEASE_HISTORY = [
  {
    version: ${JSON.stringify(targetVersion)},
    date: ${JSON.stringify(date)},
    notes: RELEASE_NOTES
  },
  {
    version: ${JSON.stringify(current.version)},
    date: ${JSON.stringify(current.date)},
    notes: ${archivedName}
  },`
  );
  return updated;
}

function updateChangelog(source: string, targetVersion: string, date: string) {
  const unreleased = readUnreleasedSection(source);
  const releasedBody = unreleased.body;
  const replacement = `## Unreleased\n\n## ${targetVersion} - ${date}\n\n${releasedBody}\n\n`;
  return source.slice(0, unreleased.headingStart) + replacement + source.slice(unreleased.bodyEnd);
}

function assertConsistent(root: string, overrides: ReleaseFileOverrides = {}) {
  const violations = checkReleaseConsistency(root, overrides);
  if (violations.length) {
    throw new Error(`release consistency check failed:\n${violations.map((item) => `- ${formatReleaseViolation(item)}`).join("\n")}`);
  }
}

export function prepareRelease(targetVersion: string, options: PrepareReleaseOptions = {}): PrepareReleaseResult {
  const root = path.resolve(options.root ?? process.cwd());
  const dryRun = options.dryRun ?? false;
  const date = options.date ?? localDate();

  if (!parseSemVer(targetVersion)) throw new Error(`target version is not valid SemVer: ${targetVersion}`);
  if (!dryRun) {
    const status = gitStatus(root);
    if (status) throw new Error(`working tree must be clean before release preparation:\n${status}`);
  }

  assertConsistent(root);
  const originals = Object.fromEntries(
    MANAGED_FILES.map((file) => [file, fs.readFileSync(path.join(root, file), "utf8")])
  ) as Record<(typeof MANAGED_FILES)[number], string>;
  const current = parseReleaseMetadata(originals["src/shared/release.ts"]);
  if (compareSemVer(targetVersion, current.version) <= 0) {
    throw new Error(`target version ${targetVersion} must be higher than current version ${current.version}`);
  }

  const unreleased = readUnreleasedSection(originals["CHANGELOG.md"]);
  if (!unreleased.notes.length) throw new Error("CHANGELOG.md: Unreleased must contain at least one release note");

  const packagePreviews = updatePackagePreviews(
    originals["package.json"],
    originals["package-lock.json"],
    targetVersion
  );
  const previews: ReleaseFileOverrides = {
    ...packagePreviews,
    "src/shared/release.ts": updateReleaseSource(
      originals["src/shared/release.ts"],
      targetVersion,
      date,
      unreleased.notes
    ),
    "CHANGELOG.md": updateChangelog(originals["CHANGELOG.md"], targetVersion, date)
  };
  assertConsistent(root, previews);

  const result = {
    currentVersion: current.version,
    targetVersion,
    date,
    notes: unreleased.notes,
    dryRun
  };
  if (dryRun) return result;

  try {
    execFileSync(
      npmCommand(),
      ["version", targetVersion, "--no-git-tag-version", "--ignore-scripts"],
      { cwd: root, stdio: "pipe" }
    );
    fs.writeFileSync(path.join(root, "src/shared/release.ts"), previews["src/shared/release.ts"]);
    fs.writeFileSync(path.join(root, "CHANGELOG.md"), previews["CHANGELOG.md"]);
    assertConsistent(root);
    if (options.runCheckRelease !== false) {
      execFileSync(npmCommand(), ["run", "check:release"], { cwd: root, stdio: "inherit" });
    }
  } catch (error) {
    for (const file of MANAGED_FILES) fs.writeFileSync(path.join(root, file), originals[file]);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`release preparation failed; managed files were restored: ${message}`);
  }

  return result;
}

function usage() {
  return "Usage: npm run release:prepare -- <version> [--dry-run]";
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const positional = args.filter((arg) => arg !== "--dry-run");
  if (positional.length !== 1 || args.some((arg) => arg.startsWith("--") && arg !== "--dry-run")) {
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  try {
    const result = prepareRelease(positional[0], { dryRun });
    const action = result.dryRun ? "Dry run passed" : "Release preparation completed";
    console.log(
      `${action}: ${result.currentVersion} -> ${result.targetVersion} (${result.date}, ${result.notes.length} notes).`
    );
    if (result.dryRun) console.log("No files were changed.");
    else console.log("No commit, tag, push, deployment, or GitHub Release was created.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
