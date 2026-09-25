import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createVerificationPlan, detectChangedFiles, parseOptions } from "./verify-changed.js";

function summary(files: string[]) {
  const plan = createVerificationPlan(files);
  return {
    domains: plan.domains,
    commands: plan.commands,
    fallbackReasons: plan.fallbackReasons
  };
}

test("single client file runs client type checking and tests", () => {
  assert.deepEqual(summary(["src/client/store.ts"]), {
    domains: ["client"],
    commands: ["npm run lint", "npm run check:client", "npm run test:client"],
    fallbackReasons: []
  });
});

test("single server file runs server type checking and tests", () => {
  assert.deepEqual(summary(["src/server/linkPreview.ts"]), {
    domains: ["server"],
    commands: ["npm run lint", "npm run check:server", "npm run test:server"],
    fallbackReasons: []
  });
});

test("shared types cover both clients plus shared tests", () => {
  assert.deepEqual(summary(["src/shared/types.ts"]), {
    domains: ["shared"],
    commands: [
      "npm run lint",
      "npm run check:client",
      "npm run check:server",
      "npm run test:client",
      "npm run test:server",
      "npm run test:shared"
    ],
    fallbackReasons: []
  });
});

test("Prisma schema generates the client and performs full server verification", () => {
  assert.deepEqual(summary(["prisma/schema.prisma"]), {
    domains: ["prisma"],
    commands: [
      "npm run prisma:generate",
      "npm run check:server",
      "npm run test:server",
      "npm run build:server"
    ],
    fallbackReasons: []
  });
});

test("package metadata falls back to full verification", () => {
  const plan = summary(["package.json"]);
  assert.deepEqual(plan.domains, ["configuration"]);
  assert.deepEqual(plan.commands, ["npm run verify:full"]);
  assert.equal(plan.fallbackReasons.length, 1);
});

test("multiple source domains combine commands without duplicates", () => {
  assert.deepEqual(summary(["src/server/main.ts", "src/client/api.ts"]), {
    domains: ["client", "server"],
    commands: [
      "npm run lint",
      "npm run check:client",
      "npm run check:server",
      "npm run test:client",
      "npm run test:server"
    ],
    fallbackReasons: []
  });
});

test("unknown critical files fall back to full verification", () => {
  const plan = summary(["config/runtime.json"]);
  assert.deepEqual(plan.domains, ["unknown critical"]);
  assert.deepEqual(plan.commands, ["npm run verify:full"]);
  assert.equal(plan.fallbackReasons.length, 1);
});

test("documentation-only changes run the public-tree safety check", () => {
  assert.deepEqual(summary(["docs/development-index.md"]), {
    domains: ["documentation/release"],
    commands: ["npm run check:public-tree"],
    fallbackReasons: []
  });
});

test("release documentation adds the release consistency check", () => {
  assert.deepEqual(summary(["README.md"]), {
    domains: ["documentation/release"],
    commands: ["npm run check:public-tree", "npm run check:release"],
    fallbackReasons: []
  });
});

test("service worker changes run its tests and release consistency", () => {
  assert.deepEqual(summary(["public/sw.js"]), {
    domains: ["service-worker"],
    commands: ["npm run check:release", "npm run test:service-worker"],
    fallbackReasons: []
  });
});

test("script changes run the server compiler and script tests", () => {
  assert.deepEqual(summary(["src/scripts/check-public-tree.ts"]), {
    domains: ["scripts"],
    commands: ["npm run check:server", "npm run test:scripts"],
    fallbackReasons: []
  });
});

test("GitHub workflow changes are recognized and conservatively run everything", () => {
  const plan = summary([".github/workflows/ci.yml"]);
  assert.deepEqual(plan.domains, ["GitHub workflow"]);
  assert.deepEqual(plan.commands, ["npm run verify:full"]);
  assert.equal(plan.fallbackReasons.length, 1);
});

test("verification infrastructure cannot select only its own focused checks", () => {
  for (const name of ["verify-changed", "run-tests", "test-file-groups"]) {
    assert.deepEqual(createVerificationPlan([`src/scripts/${name}.ts`]).commands, ["npm run verify:full"]);
  }
});

test("CLI scope options reject ambiguous or incomplete input", () => {
  assert.deepEqual(parseOptions(["--staged", "--quiet", "--dry-run"]), {
    base: "HEAD", staged: true, quiet: true, dryRun: true
  });
  assert.equal(parseOptions(["--base", "main"]).base, "main");
  for (const args of [["--base"], ["--base", "--quiet"], ["--staged", "--base", "HEAD"], ["--typo"]]) {
    assert.throws(() => parseOptions(args));
  }
});

test("staged scope preserves unrelated untracked work and refuses a mismatched working tree", () => {
  const root = mkdtempSync(path.join(tmpdir(), "verify-scope-test-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  try {
    git("init");
    writeFileSync(path.join(root, "tracked.txt"), "baseline");
    git("add", "tracked.txt");
    git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "baseline");
    mkdirSync(path.join(root, "docs"));
    writeFileSync(path.join(root, "docs/task notes.md"), "task");
    git("add", "docs/task notes.md");
    mkdirSync(path.join(root, "prototype"));
    writeFileSync(path.join(root, "prototype/unrelated.html"), "existing work");
    assert.deepEqual(detectChangedFiles("HEAD", { root, staged: true }), ["docs/task notes.md"]);
    assert.deepEqual(detectChangedFiles("HEAD", { root }), ["docs/task notes.md", "prototype/unrelated.html"]);
    assert.deepEqual(createVerificationPlan(detectChangedFiles("HEAD", { root, staged: true })).commands, ["npm run check:public-tree"]);
    writeFileSync(path.join(root, "docs/task notes.md"), "edited after staging");
    assert.throws(() => detectChangedFiles("HEAD", { root, staged: true }), /match the index/);
    git("add", "docs/task notes.md");
    writeFileSync(path.join(root, "tracked.txt"), "unrelated tracked edits");
    assert.throws(() => detectChangedFiles("HEAD", { root, staged: true }), /do not stage unrelated work/);
    git("restore", "tracked.txt");
    git("mv", "tracked.txt", "renamed.txt");
    assert.deepEqual(detectChangedFiles("HEAD", { root, staged: true }), ["docs/task notes.md", "renamed.txt", "tracked.txt"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI distinguishes preview, empty scope, success and failure while retaining bounded logs", () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "verify-cli-test-")));
  const logDirs = new Set<string>();
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  try {
    mkdirSync(path.join(root, "src/scripts"), { recursive: true });
    const script = path.join(root, "src/scripts/verify-changed.ts");
    copyFileSync(fileURLToPath(new URL("./verify-changed.ts", import.meta.url)), script);
    writeFileSync(path.join(root, "package.json"), JSON.stringify({
      type: "module",
      scripts: { "check:public-tree": "node fixture.cjs" }
    }));
    writeFileSync(path.join(root, "fixture.cjs"), 'console.log("log-start:" + "x".repeat(9000)); console.error("log-end"); process.exit(process.env.VERIFY_FIXTURE_FAIL ? 7 : 0);');
    git("init");
    git("add", "src", "package.json", "fixture.cjs");
    git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "baseline");
    const run = (args: string[], fail = false) => {
      const result = spawnSync(process.execPath, ["--import", "tsx", script, ...args], {
        encoding: "utf8", env: { ...process.env, VERIFY_FIXTURE_FAIL: fail ? "1" : "" }
      });
      for (const match of result.stdout.matchAll(/\(log: (.+)\)/g)) logDirs.add(path.dirname(match[1]));
      return result;
    };
    const empty = run(["--staged"]);
    assert.equal(empty.status, 1);
    assert.match(empty.stderr, /No checks selected/);
    mkdirSync(path.join(root, "docs"));
    writeFileSync(path.join(root, "docs/task.md"), "task");
    git("add", "docs/task.md");
    const preview = run(["--staged", "--dry-run", "--quiet"]);
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /Dry run: no checks executed/);
    assert.doesNotMatch(preview.stdout, /Running:|Passed:|docs\/task.md/);
    const success = run(["--staged", "--quiet"]);
    assert.equal(success.status, 0, success.stderr);
    assert.match(success.stdout, /Passed: npm run check:public-tree/);
    assert.doesNotMatch(success.stdout, /log-start/);
    const failure = run(["--staged", "--quiet"], true);
    assert.equal(failure.status, 7);
    assert.match(failure.stderr, /log-end/);
    assert.match(failure.stderr, /Failed: npm run check:public-tree/);
    assert.doesNotMatch(failure.stderr, /log-start/);
    assert.ok(failure.stderr.length < 7000);
    assert.equal(logDirs.size, 2);
    for (const dir of logDirs) {
      const log = readFileSync(path.join(dir, "output.log"), "utf8");
      assert.match(log, /log-start/);
      assert.match(log, /log-end/);
    }
  } finally {
    for (const dir of logDirs) rmSync(dir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
