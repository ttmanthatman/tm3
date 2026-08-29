import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_LICENSE = "GPL-3.0-only";

export interface ReleaseConsistencyViolation {
  files: string[];
  message: string;
}

export interface ReleaseMetadata {
  version: string;
  date: string;
  notes: string[];
}

export interface ReleaseHistoryEntry {
  version: string;
  date: string;
  notesReference: string;
}

export interface ChangelogRelease {
  version: string;
  date: string;
  notes: string[];
}

export type ReleaseFileOverrides = Readonly<Record<string, string>>;

function readFile(root: string, file: string, overrides: ReleaseFileOverrides) {
  return overrides[file] ?? fs.readFileSync(path.join(root, file), "utf8");
}

function requiredMatch(source: string, pattern: RegExp, description: string) {
  const match = pattern.exec(source);
  if (!match?.[1]) throw new Error(`could not find ${description}`);
  return match[1];
}

function parseStringArray(body: string, description: string): string[] {
  try {
    const value = JSON.parse(`[${body}]`);
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error("not a string array");
    return value;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`could not parse ${description}: ${message}`);
  }
}

export function parseReleaseMetadata(source: string): ReleaseMetadata {
  const version = requiredMatch(source, /^export const APP_VERSION = "([^"]+)";$/m, "APP_VERSION");
  const date = requiredMatch(source, /^export const RELEASE_DATE = "([^"]+)";$/m, "RELEASE_DATE");
  const notesBody = requiredMatch(
    source,
    /^export const RELEASE_NOTES = \[\n([\s\S]*?)\n\] as const;$/m,
    "RELEASE_NOTES"
  );

  return {
    version,
    date,
    notes: parseStringArray(notesBody, "RELEASE_NOTES")
  };
}

export function parseReleaseHistory(source: string): ReleaseHistoryEntry {
  const history = /export const RELEASE_HISTORY = \[\s*\{\s*version: "([^"]+)",\s*date: "([^"]+)",\s*notes: ([A-Z0-9_]+)/m.exec(
    source
  );
  if (!history) throw new Error("could not find the latest RELEASE_HISTORY entry");
  return { version: history[1], date: history[2], notesReference: history[3] };
}

function sectionBody(source: string, headingStart: number, headingEnd: number) {
  const nextHeading = source.slice(headingEnd).search(/^## /m);
  return source.slice(headingEnd, nextHeading === -1 ? source.length : headingEnd + nextHeading).trim();
}

export function parseMarkdownNotes(body: string): string[] {
  const notes: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const bullet = /^[-*]\s+(.+\S|\S)$/.exec(line);
    if (bullet) {
      notes.push(bullet[1].trim());
      continue;
    }
    if (/^\s+\S/.test(line) && notes.length) notes[notes.length - 1] += ` ${line.trim()}`;
  }
  return notes;
}

export function readUnreleasedSection(source: string) {
  const heading = /^## Unreleased\s*$/m.exec(source);
  if (!heading || heading.index === undefined) throw new Error("could not find `## Unreleased`");
  const bodyStart = heading.index + heading[0].length;
  const nextHeadingOffset = source.slice(bodyStart).search(/^## /m);
  const bodyEnd = nextHeadingOffset === -1 ? source.length : bodyStart + nextHeadingOffset;
  const body = source.slice(bodyStart, bodyEnd).trim();
  return { headingStart: heading.index, bodyStart, bodyEnd, body, notes: parseMarkdownNotes(body) };
}

export function parseLatestChangelogRelease(source: string): ChangelogRelease {
  const heading = /^## (?!Unreleased\s*$)(\S+) - (\d{4}-\d{2}-\d{2})\s*$/m.exec(source);
  if (!heading || heading.index === undefined) throw new Error("could not find the latest formal release heading");
  const headingEnd = heading.index + heading[0].length;
  return {
    version: heading[1],
    date: heading[2],
    notes: parseMarkdownNotes(sectionBody(source, heading.index, headingEnd))
  };
}

export function isValidReleaseDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function sameNotes(left: string[], right: string[]) {
  return left.length === right.length && left.every((note, index) => note === right[index]);
}

export function checkReleaseConsistency(
  root = process.cwd(),
  overrides: ReleaseFileOverrides = {}
): ReleaseConsistencyViolation[] {
  const violations: ReleaseConsistencyViolation[] = [];
  const add = (files: string[], message: string) => violations.push({ files, message });

  let packageJson: { version?: string; license?: string };
  let packageLock: {
    version?: string;
    packages?: Record<string, { version?: string; license?: string }>;
  };
  let release: ReleaseMetadata;
  let history: ReleaseHistoryEntry;
  let changelog: ChangelogRelease;
  let releaseSource: string;
  let releaseHistorySource: string;
  let changelogSource: string;
  let readme: string;
  let serviceWorker: string;
  let clientMain: string;

  try {
    packageJson = JSON.parse(readFile(root, "package.json", overrides));
    packageLock = JSON.parse(readFile(root, "package-lock.json", overrides));
    releaseSource = readFile(root, "src/shared/release.ts", overrides);
    releaseHistorySource = readFile(root, "src/shared/releaseHistory.ts", overrides);
    changelogSource = readFile(root, "CHANGELOG.md", overrides);
    readme = readFile(root, "README.md", overrides);
    serviceWorker = readFile(root, "public/sw.js", overrides);
    clientMain = readFile(root, "src/client/main.ts", overrides);
    release = parseReleaseMetadata(releaseSource);
    history = parseReleaseHistory(releaseHistorySource);
    changelog = parseLatestChangelogRelease(changelogSource);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [{ files: ["release files"], message }];
  }

  const lockRoot = packageLock.packages?.[""];
  if (packageJson.version !== packageLock.version || packageJson.version !== lockRoot?.version) {
    add(
      ["package.json", "package-lock.json"],
      `version mismatch: package.json=${packageJson.version ?? "missing"}, package-lock.json=${packageLock.version ?? "missing"}, package-lock root=${lockRoot?.version ?? "missing"}`
    );
  }
  if (packageJson.version !== release.version) {
    add(
      ["package.json", "src/shared/release.ts"],
      `version mismatch: package.json=${packageJson.version ?? "missing"}, APP_VERSION=${release.version}`
    );
  }
  if (!isValidReleaseDate(release.date)) {
    add(["src/shared/release.ts"], `RELEASE_DATE is not a real YYYY-MM-DD date: ${release.date}`);
  }
  if (changelog.version !== packageJson.version) {
    add(
      ["CHANGELOG.md", "package.json"],
      `latest formal changelog version=${changelog.version}, current version=${packageJson.version ?? "missing"}`
    );
  }
  const unreleasedHeading = /^## Unreleased\s*$/m.exec(changelogSource);
  const latestFormalHeading = /^## (?!Unreleased\s*$)\S+ - \d{4}-\d{2}-\d{2}\s*$/m.exec(changelogSource);
  if (
    !unreleasedHeading
    || unreleasedHeading.index === undefined
    || (latestFormalHeading?.index !== undefined && unreleasedHeading.index > latestFormalHeading.index)
  ) {
    add(["CHANGELOG.md"], "`## Unreleased` must appear above the latest formal release");
  }
  if (changelog.date !== release.date) {
    add(
      ["CHANGELOG.md", "src/shared/release.ts"],
      `latest formal changelog date=${changelog.date}, RELEASE_DATE=${release.date}`
    );
  }
  if (!sameNotes(changelog.notes, release.notes)) {
    add(["CHANGELOG.md", "src/shared/release.ts"], "latest formal changelog notes do not match RELEASE_NOTES");
  }
  if (
    history.version !== release.version
    || history.date !== release.date
    || history.notesReference !== "RELEASE_NOTES"
  ) {
    add(
      ["src/shared/release.ts", "src/shared/releaseHistory.ts"],
      `latest RELEASE_HISTORY entry must use version ${release.version}, date ${release.date}, and RELEASE_NOTES`
    );
  }
  if (
    !/import \{ APP_VERSION \} from ["']@shared\/release["'];/.test(clientMain)
    || !/serviceWorker\.register\(`\/sw\.js\?v=\$\{encodeURIComponent\(APP_VERSION\)\}`/.test(clientMain)
  ) {
    add(
      ["src/client/main.ts", "src/shared/release.ts"],
      "service worker registration must derive its v query parameter from shared APP_VERSION"
    );
  }
  if (
    !/APP_VERSION = SW_URL\.searchParams\.get\("v"\) \|\| "dev"/.test(serviceWorker)
    || !/APP_CACHE = `\$\{APP_CACHE_PREFIX\}\$\{APP_VERSION\}`/.test(serviceWorker)
  ) {
    add(
      ["public/sw.js", "src/client/main.ts"],
      "application cache name must derive from the service worker v query parameter"
    );
  }
  if (/img\.shields\.io\/badge\/version-[^) \n]+/i.test(readme)) {
    add(["README.md"], "README contains a hard-coded version badge; use a package.json-backed badge or omit it");
  }
  if (packageJson.license !== EXPECTED_LICENSE || lockRoot?.license !== EXPECTED_LICENSE) {
    add(
      ["package.json", "package-lock.json"],
      `license must remain ${EXPECTED_LICENSE}; package.json=${packageJson.license ?? "missing"}, package-lock root=${lockRoot?.license ?? "missing"}`
    );
  }

  return violations;
}

export function formatReleaseViolation(violation: ReleaseConsistencyViolation) {
  return `[${violation.files.join(" ↔ ")}] ${violation.message}`;
}

function main() {
  const violations = checkReleaseConsistency();
  if (violations.length) {
    console.error("Release consistency check failed:");
    for (const violation of violations) console.error(`- ${formatReleaseViolation(violation)}`);
    process.exitCode = 1;
    return;
  }
  console.log("Release consistency check passed.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
