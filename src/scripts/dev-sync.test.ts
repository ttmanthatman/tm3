import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../../scripts/dev-sync.mjs", import.meta.url));

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "dev-sync-"));
  const remote = path.join(root, "remote.git");
  const first = path.join(root, "first");
  const second = path.join(root, "second");
  const hooks = path.join(root, "empty-hooks");
  mkdirSync(hooks);
  const globalConfig = path.join(root, "gitconfig");
  writeFileSync(globalConfig, "");
  const env = {
    ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_COUNT: "0",
    GIT_AUTHOR_NAME: "Sync Test", GIT_AUTHOR_EMAIL: "sync@example.invalid",
    GIT_COMMITTER_NAME: "Sync Test", GIT_COMMITTER_EMAIL: "sync@example.invalid",
    GIT_TERMINAL_PROMPT: "0"
  };
  const git = (cwd: string, ...args: string[]) => execFileSync("git", [
    "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", "-c", `core.hooksPath=${hooks}`, ...args
  ], { cwd, env, encoding: "utf8", stdio: "pipe" }).trim();
  git(root, "init", "--bare", "--initial-branch=main", remote);
  git(root, "clone", remote, first);
  writeFileSync(path.join(first, "tracked.txt"), "baseline\n");
  git(first, "add", "tracked.txt");
  git(first, "commit", "-m", "baseline");
  git(first, "push", "-u", "origin", "main");
  git(root, "clone", remote, second);
  const head = (cwd = first) => git(cwd, "rev-parse", "HEAD");
  const commit = (cwd: string, file: string, content: string) => {
    writeFileSync(path.join(cwd, file), content);
    git(cwd, "add", file);
    git(cwd, "commit", "-m", file);
    return head(cwd);
  };
  const advance = () => {
    const target = commit(second, "other-device.txt", "from another device\n");
    git(second, "push");
    return target;
  };
  const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { cwd: first, env, encoding: "utf8" });
  const unchanged = (before: string, output: ReturnType<typeof run>, pattern: RegExp) => {
    assert.equal(output.status, 1, output.stdout + output.stderr);
    assert.match(output.stderr, pattern);
    assert.equal(head(), before);
  };
  return { root, remote, first, second, env, git, head, commit, advance, run, unchanged, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("status defaults to a local read and sync fast-forwards to the latest upstream", () => {
  const f = fixture();
  try {
    const before = f.head();
    const target = f.advance();
    const status = f.run();
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /分支：main/);
    assert.match(status.stdout, new RegExp(before));
    assert.match(status.stdout, /上游：origin\/main/);
    assert.match(status.stdout, /领先\/落后：0\/0.*本地缓存/);
    assert.equal(f.head(), before);
    assert.equal(f.git(f.first, "rev-parse", "origin/main"), before);
    const sync = f.run("sync");
    assert.equal(sync.status, 0, sync.stderr);
    assert.match(sync.stdout, /已快进 1 个提交/);
    assert.equal(f.head(), target);
    assert.equal(readFileSync(path.join(f.first, "other-device.txt"), "utf8"), "from another device\n");
    const again = f.run("sync");
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /已是最新/);
    assert.equal(f.head(), target);
  } finally { f.cleanup(); }
});

test("sync refuses tracked, staged and untracked changes without touching their contents or index", () => {
  const f = fixture();
  try {
    const before = f.head();
    f.advance();
    for (const kind of ["tracked", "staged", "untracked"]) {
      const file = kind === "untracked" ? "notes.txt" : "tracked.txt";
      const content = `${kind} local work\n`;
      writeFileSync(path.join(f.first, file), content);
      if (kind === "staged") f.git(f.first, "add", file);
      const statusBefore = f.git(f.first, "status", "--porcelain=v1");
      const indexBefore = f.git(f.first, "write-tree");
      f.unchanged(before, f.run("sync"), /未提交或未跟踪/);
      assert.equal(readFileSync(path.join(f.first, file), "utf8"), content);
      assert.equal(f.git(f.first, "status", "--porcelain=v1"), statusBefore);
      assert.equal(f.git(f.first, "write-tree"), indexBefore);
      assert.equal(f.git(f.first, "rev-parse", "origin/main"), before, "dirty refusal must happen before fetch");
      if (kind === "untracked") rmSync(path.join(f.first, file));
      else f.git(f.first, "restore", "--staged", "--worktree", file);
    }
  } finally { f.cleanup(); }
});

test("sync rejects ahead and diverged branches after fetching without changing local commits", () => {
  const f = fixture();
  try {
    const local = f.commit(f.first, "local.txt", "local commit\n");
    f.unchanged(local, f.run("sync"), /本地领先上游 1/);
    const remote = f.advance();
    f.unchanged(local, f.run("sync"), /已分叉.*领先 1.*落后 1/);
    assert.equal(f.git(f.first, "rev-parse", "origin/main"), remote);
    assert.equal(readFileSync(path.join(f.first, "local.txt"), "utf8"), "local commit\n");
  } finally { f.cleanup(); }
});

test("sync refuses detached HEAD, missing upstream and local upstream", () => {
  const f = fixture();
  try {
    const before = f.head();
    f.git(f.first, "checkout", "--detach");
    f.unchanged(before, f.run("sync"), /游离 HEAD/);
    f.git(f.first, "checkout", "main");
    f.git(f.first, "branch", "--unset-upstream");
    f.unchanged(before, f.run("sync"), /未配置上游/);
    f.git(f.first, "branch", "local-upstream");
    f.git(f.first, "branch", "--set-upstream-to=local-upstream");
    f.unchanged(before, f.run("sync"), /本地 remote '\.'/);
  } finally { f.cleanup(); }
});

test("fetch failure never fast-forwards from a previously cached remote commit", () => {
  const f = fixture();
  try {
    const before = f.head();
    const cached = f.advance();
    f.git(f.first, "fetch");
    f.git(f.first, "remote", "set-url", "origin", path.join(f.root, "unavailable.git"));
    f.unchanged(before, f.run("sync"), /获取上游失败.*不会使用旧缓存/);
    assert.equal(f.git(f.first, "rev-parse", "origin/main"), cached);
    assert.equal(readFileSync(path.join(f.first, "tracked.txt"), "utf8"), "baseline\n");
    const status = f.run("status");
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /领先\/落后：0\/1/);
  } finally { f.cleanup(); }
});

test("sync follows a non-origin upstream and branch names containing slashes", () => {
  const f = fixture();
  try {
    f.git(f.first, "remote", "rename", "origin", "handoff");
    f.git(f.second, "checkout", "-b", "devices/shared");
    const target = f.commit(f.second, "shared.txt", "shared branch\n");
    f.git(f.second, "push", "-u", "origin", "devices/shared");
    f.git(f.first, "fetch", "handoff");
    f.git(f.first, "checkout", "-b", "devices/shared", "--track", "handoff/devices/shared");
    f.commit(f.second, "latest.txt", "latest branch\n");
    f.git(f.second, "push");
    assert.equal(f.head(), target);
    const result = f.run("sync");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /获取 handoff 的 refs\/heads\/devices\/shared/);
    assert.equal(f.head(), f.head(f.second));
    assert.equal(f.git(f.first, "branch", "--show-current"), "devices/shared");
  } finally { f.cleanup(); }
});

test("sync rejects active merge, rebase, cherry-pick, revert and bisect states before fetching", () => {
  const f = fixture();
  try {
    const before = f.head();
    f.advance();
    for (const marker of ["MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD", "REVERT_HEAD", "sequencer", "BISECT_LOG"]) {
      const markerPath = path.resolve(f.first, f.git(f.first, "rev-parse", "--git-path", marker));
      if (["rebase-merge", "rebase-apply", "sequencer"].includes(marker)) mkdirSync(markerPath);
      else writeFileSync(markerPath, `${before}\n`);
      f.unchanged(before, f.run("sync"), /正在进行/);
      assert.equal(f.git(f.first, "rev-parse", "origin/main"), before);
      rmSync(markerPath, { recursive: true, force: true });
    }
  } finally { f.cleanup(); }
});

test("sync refuses to overwrite an ignored file introduced by the upstream", () => {
  const f = fixture();
  try {
    f.commit(f.first, ".gitignore", "private.txt\n");
    f.git(f.first, "push");
    f.git(f.second, "pull", "--ff-only");
    writeFileSync(path.join(f.second, "private.txt"), "remote content\n");
    f.git(f.second, "add", "--force", "private.txt");
    f.git(f.second, "commit", "-m", "introduce private file");
    f.git(f.second, "push");
    const before = f.head();
    writeFileSync(path.join(f.first, "private.txt"), "keep local content\n");
    f.unchanged(before, f.run("sync"), /快进未完成/);
    assert.equal(readFileSync(path.join(f.first, "private.txt"), "utf8"), "keep local content\n");
  } finally { f.cleanup(); }
});

test("sync rechecks local changes made while fetch is running", () => {
  const f = fixture();
  try {
    const before = f.head();
    const target = f.advance();
    const hookDir = path.join(f.root, "fetch-hooks");
    const localFile = path.join(f.first, "concurrent-notes.txt");
    mkdirSync(hookDir);
    const hook = path.join(hookDir, "reference-transaction");
    writeFileSync(hook, `#!${process.execPath}\nconst fs = require("node:fs");\nconst refs = fs.readFileSync(0, "utf8");\nif (process.argv[2] === "committed" && refs.includes("refs/remotes/origin/main")) fs.writeFileSync(${JSON.stringify(localFile)}, "work created during fetch\\n");\n`);
    chmodSync(hook, 0o755);
    f.git(f.first, "config", "core.hooksPath", hookDir);
    f.unchanged(before, f.run("sync"), /未提交或未跟踪/);
    assert.equal(f.git(f.first, "rev-parse", "origin/main"), target);
    assert.equal(readFileSync(localFile, "utf8"), "work created during fetch\n");
  } finally { f.cleanup(); }
});

test("unknown arguments fail without fetching or moving HEAD", () => {
  const f = fixture();
  try {
    const before = f.head();
    f.advance();
    for (const args of [["pull"], ["sync", "extra"]]) f.unchanged(before, f.run(...args), /用法/);
    assert.equal(f.git(f.first, "rev-parse", "origin/main"), before);
  } finally { f.cleanup(); }
});
