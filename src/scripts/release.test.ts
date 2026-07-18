import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkReleaseConsistency, parseReleaseMetadata } from "./check-release-consistency.js";
import { prepareRelease } from "./prepare-release.js";

const CURRENT_VERSION = "1.5.6";
const CURRENT_DATE = "2026-07-17";

function write(root: string, file: string, contents: string) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function releaseSource() {
  return `export const APP_VERSION = "${CURRENT_VERSION}";

export const RELEASE_DATE = "${CURRENT_DATE}";

export const RELEASE_DEVELOPER = "Team Chat";

export const RELEASE_NOTES = [
  "Current release note."
] as const;

const RELEASE_1_5_5_NOTES = [
  "Previous release note."
] as const;

export const RELEASE_HISTORY = [
  {
    version: "${CURRENT_VERSION}",
    date: "${CURRENT_DATE}",
    notes: RELEASE_NOTES
  },
  {
    version: "1.5.5",
    date: "2026-07-16",
    notes: RELEASE_1_5_5_NOTES
  }
] as const;
`;
}

function changelogSource(unreleased = "- A visible new feature.\n- A visible bug fix.") {
  return `# Changelog

## Unreleased

${unreleased}

## ${CURRENT_VERSION} - ${CURRENT_DATE}

- Current release note.

## 1.5.5 - 2026-07-16

- Previous release note.
`;
}

function makeFixture(t: test.TestContext, unreleased?: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tm3-release-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const packageJson = {
    name: "tm3-release-fixture",
    version: CURRENT_VERSION,
    license: "GPL-3.0-only",
    type: "module"
  };
  const packageLock = {
    name: "tm3-release-fixture",
    version: CURRENT_VERSION,
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name: "tm3-release-fixture",
        version: CURRENT_VERSION,
        license: "GPL-3.0-only"
      }
    }
  };

  write(root, "package.json", `${JSON.stringify(packageJson, null, 2)}\n`);
  write(root, "package-lock.json", `${JSON.stringify(packageLock, null, 2)}\n`);
  write(root, "src/shared/release.ts", releaseSource());
  write(root, "CHANGELOG.md", changelogSource(unreleased));
  write(
    root,
    "README.md",
    "![Version](https://img.shields.io/github/package-json/v/ttmanthatman/tm3?label=version)\n"
  );
  write(
    root,
    "src/client/main.ts",
    `import { APP_VERSION } from "@shared/release";
navigator.serviceWorker.register(\`/sw.js?v=\${encodeURIComponent(APP_VERSION)}\`, { updateViaCache: "none" });
`
  );
  write(
    root,
    "public/sw.js",
    `const SW_URL = new URL(self.location.href || self.location.origin);
const APP_VERSION = SW_URL.searchParams.get("v") || "dev";
const APP_CACHE_PREFIX = "team-chat-app-";
const APP_CACHE = \`\${APP_CACHE_PREFIX}\${APP_VERSION}\`;
`
  );

  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "release-test@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Release Test"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
  return root;
}

function snapshot(root: string) {
  return ["package.json", "package-lock.json", "src/shared/release.ts", "CHANGELOG.md"].map((file) =>
    fs.readFileSync(path.join(root, file), "utf8")
  );
}

test("release preparation rejects an invalid target version", (t) => {
  const root = makeFixture(t);
  assert.throws(
    () => prepareRelease("1.5", { root, dryRun: true, date: "2026-07-18" }),
    /not valid SemVer/
  );
});

test("release preparation rejects version regression", (t) => {
  const root = makeFixture(t);
  assert.throws(
    () => prepareRelease("1.5.5", { root, dryRun: true, date: "2026-07-18" }),
    /must be higher than current version/
  );
});

test("release preparation rejects an empty Unreleased section", (t) => {
  const root = makeFixture(t, "");
  assert.throws(
    () => prepareRelease("1.5.7", { root, dryRun: true, date: "2026-07-18" }),
    /Unreleased must contain at least one release note/
  );
});

test("release preparation dry-run does not write files", (t) => {
  const root = makeFixture(t);
  const before = snapshot(root);
  const result = prepareRelease("1.5.7", { root, dryRun: true, date: "2026-07-18" });
  assert.equal(result.dryRun, true);
  assert.deepEqual(snapshot(root), before);
  assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }), "");
});

test("release preparation updates all release files without committing or tagging", (t) => {
  const root = makeFixture(t);
  const commitBefore = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

  prepareRelease("1.5.7", {
    root,
    date: "2026-07-18",
    runCheckRelease: false
  });

  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const packageLock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const release = fs.readFileSync(path.join(root, "src/shared/release.ts"), "utf8");
  const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
  const metadata = parseReleaseMetadata(release);

  assert.equal(packageJson.version, "1.5.7");
  assert.equal(packageLock.version, "1.5.7");
  assert.equal(packageLock.packages[""].version, "1.5.7");
  assert.equal(metadata.version, "1.5.7");
  assert.equal(metadata.date, "2026-07-18");
  assert.deepEqual(metadata.notes, ["A visible new feature.", "A visible bug fix."]);
  assert.match(release, /const RELEASE_1_5_6_NOTES = \[/);
  assert.match(release, /version: "1\.5\.6",\n    date: "2026-07-17",\n    notes: RELEASE_1_5_6_NOTES/);
  assert.match(changelog, /^## Unreleased\n\n## 1\.5\.7 - 2026-07-18$/m);
  assert.deepEqual(checkReleaseConsistency(root), []);
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), commitBefore);
  assert.equal(execFileSync("git", ["tag", "--list"], { cwd: root, encoding: "utf8" }), "");
});

test("consistency check reports every inconsistent file group", (t) => {
  const root = makeFixture(t);
  const lockPath = path.join(root, "package-lock.json");
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  lock.version = "1.5.4";
  lock.packages[""].version = "1.5.4";
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  fs.writeFileSync(
    path.join(root, "README.md"),
    "![Version](https://img.shields.io/badge/version-1.5.6-green)\n"
  );
  fs.writeFileSync(path.join(root, "src/client/main.ts"), "navigator.serviceWorker.register('/sw.js');\n");

  const violations = checkReleaseConsistency(root);
  assert.ok(violations.some((item) => item.files.includes("package-lock.json")));
  assert.ok(violations.some((item) => item.files.includes("README.md")));
  assert.ok(violations.some((item) => item.files.includes("src/client/main.ts")));
});
