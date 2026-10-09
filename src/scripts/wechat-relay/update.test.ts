import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

type UpdateConfig = {
  repository: string; branch: string; stateDirectory: string; service: string;
  node: string; startTimeoutMs: number; buildEnvironment: Record<string, string>; serviceEnvironment: Record<string, string>;
};
type RunOptions = { cwd?: string; env?: Record<string, string>; timeoutMs?: number };
type Run = (command: string, args: string[], options: RunOptions) => Promise<{ stdout: string; stderr?: string }>;
type Dependencies = { run: Run; sleep: (ms: number) => Promise<void>; now: () => number; log: (message: string) => void };
const moduleUrl = pathToFileURL(path.resolve("scripts/wechat-relay/update.mjs")).href;
const updater = await import(moduleUrl) as {
  loadUpdateConfig(environment: NodeJS.ProcessEnv): UpdateConfig;
  currentRevision(current: string): string | null;
  acquireUpdateLock(directory: string): () => void;
  runUpdate(config: UpdateConfig, dependencies: Dependencies): Promise<{ status: string; revision: string }>;
};
const oldRevision = "a".repeat(40);
const newRevision = "b".repeat(40);

test("updater CLI runs through the managed current symlink", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-relay-update-cli-test-"));
  try {
    const entry = path.join(directory, "update.mjs");
    fs.symlinkSync(path.resolve("scripts/wechat-relay/update.mjs"), entry);
    const result = spawnSync(process.execPath, [entry, "--help"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage: update.mjs/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function fixture() {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wechat-relay-update-test-")));
  const releases = path.join(directory, "releases");
  const oldRelease = path.join(releases, oldRevision);
  fs.mkdirSync(oldRelease, { recursive: true });
  fs.symlinkSync(oldRelease, path.join(directory, "current"), "dir");
  fs.writeFileSync(path.join(directory, "queue-sentinel"), "uncertain stays uncertain\n");
  const config = updater.loadUpdateConfig({ HOME: directory, PATH: process.env.PATH, XDG_RUNTIME_DIR: "/run/user/1000", DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus", RELAY_UPDATE_REPOSITORY: "https://github.com/example/team-chat.git", RELAY_UPDATE_STATE_DIRECTORY: directory, RELAY_UPDATE_NODE: process.execPath, RELAY_UPDATE_START_TIMEOUT_MS: "6000" });
  return { directory, oldRelease, config, close: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

function runner(item: ReturnType<typeof fixture>, settings: { revision?: string; failBuild?: boolean; failCandidateStart?: boolean; failProbe?: boolean } = {}) {
  let clock = 0;
  let active = true;
  let pid = 100;
  const events: string[] = [];
  const run: Run = async (command, args, options) => {
    if (command === "git") {
      if (args.includes("init")) fs.mkdirSync(args.at(-1)!, { recursive: true });
      if (args.includes("rev-parse")) return { stdout: settings.revision || newRevision };
      if (args.includes("checkout")) {
        events.push("checkout");
        const stage = args[args.indexOf("--work-tree") + 1];
        fs.mkdirSync(path.join(stage, "src/scripts/wechat-relay"), { recursive: true });
        fs.mkdirSync(path.join(stage, "scripts/wechat-relay"), { recursive: true });
        fs.writeFileSync(path.join(stage, "src/scripts/wechat-relay/actual-relay.test.ts"), "// candidate tests\n");
        fs.writeFileSync(path.join(stage, "scripts/wechat-relay/update.mjs"), "// candidate updater\n");
      }
      return { stdout: "" };
    }
    if (command === "npm") {
      events.push(args.join(" "));
      assert.equal(active, true, "the running release stays active throughout the build");
      assert.equal(options.env?.RELAY_AGENT_TOKEN, undefined);
      if (settings.failBuild && args.includes("build:server")) throw new Error("candidate build failed");
      return { stdout: "" };
    }
    if (command === item.config.node) {
      if (args.includes("--test")) {
        events.push("tests");
        assert.ok(args.some((arg) => arg.endsWith("actual-relay.test.ts")), "candidate relay tests run");
      } else if (args.includes("--eval")) {
        events.push("probe");
        assert.match(args.at(-1)!, /future_relay_probe/);
        assert.match(args.at(-1)!, /messages.length, 2/);
        if (settings.failProbe) throw new Error("candidate future-message probe failed");
      } else {
        events.push("help");
        assert.equal(args.at(-1), "help");
      }
      return { stdout: "" };
    }
    assert.equal(command, "systemctl");
    assert.equal(options.env?.XDG_RUNTIME_DIR, "/run/user/1000");
    assert.equal(options.env?.DBUS_SESSION_BUS_ADDRESS, "unix:path=/run/user/1000/bus");
    assert.equal(options.env?.RELAY_AGENT_TOKEN, undefined);
    assert.equal(args[0], "--user");
    assert.equal(args[2], "wechat-relay.service");
    if (args[1] === "show") return { stdout: `ActiveState=${active ? "active" : "inactive"}\nMainPID=${active ? pid : 0}\nNRestarts=0\n` };
    events.push(args[1]);
    if (args[1] === "stop") active = false;
    if (args[1] === "start") {
      const target = fs.realpathSync(path.join(item.directory, "current"));
      if (settings.failCandidateStart && target.endsWith(newRevision)) throw new Error("candidate startup failed");
      active = true; pid += 1;
    }
    return { stdout: "" };
  };
  const dependencies: Dependencies = { run, now: () => clock, sleep: async (ms) => { clock += ms; }, log: () => undefined };
  return { dependencies, events };
}

test("updater accepts only an operator-selected HTTPS repository and fixed branch", () => {
  const config = updater.loadUpdateConfig({ HOME: os.tmpdir(), RELAY_UPDATE_REPOSITORY: "https://github.com/example/team-chat.git", RELAY_AGENT_TOKEN: "private-token", DATABASE_URL: "private-database", XDG_RUNTIME_DIR: "/run/user/1000", DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus" });
  assert.equal(config.branch, "main");
  assert.equal(config.buildEnvironment.RELAY_AGENT_TOKEN, undefined);
  assert.doesNotMatch(config.buildEnvironment.DATABASE_URL, /private/);
  assert.equal(config.buildEnvironment.DBUS_SESSION_BUS_ADDRESS, undefined);
  assert.equal(config.serviceEnvironment.DBUS_SESSION_BUS_ADDRESS, "unix:path=/run/user/1000/bus");
  assert.equal(config.serviceEnvironment.XDG_RUNTIME_DIR, "/run/user/1000");
  assert.equal(config.serviceEnvironment.RELAY_AGENT_TOKEN, undefined);
  for (const repository of ["http://example.com/a.git", "https://user:pass@example.com/a.git", "https://example.com/a.git?token=private"]) {
    assert.throws(() => updater.loadUpdateConfig({ RELAY_UPDATE_REPOSITORY: repository }), /HTTPS/);
  }
  for (const branch of ["--upload-pack=command", "main;touch unexpected", "main..other"]) {
    assert.throws(() => updater.loadUpdateConfig({ RELAY_UPDATE_REPOSITORY: "https://example.com/a.git", RELAY_UPDATE_BRANCH: branch }), /fixed repository branch/);
  }
});

test("updater lock rejects concurrent updates and recovers a dead owner", () => {
  const item = fixture();
  try {
    const release = updater.acquireUpdateLock(item.directory);
    assert.throws(() => updater.acquireUpdateLock(item.directory), /already running/);
    release();
    fs.mkdirSync(path.join(item.directory, "update-lock"));
    fs.writeFileSync(path.join(item.directory, "update-lock/pid"), "2147483647\n");
    updater.acquireUpdateLock(item.directory)();
    assert.equal(fs.existsSync(path.join(item.directory, "update-lock")), false);
  } finally { item.close(); }
});

test("upstream revision marker preserves a repaired bootstrap without restarting it", async () => {
  const item = fixture();
  try {
    fs.writeFileSync(path.join(item.oldRelease, ".relay-revision"), `${newRevision}\n`);
    const { dependencies, events } = runner(item);
    assert.deepEqual(await updater.runUpdate(item.config, dependencies), { status: "unchanged", revision: newRevision });
    assert.deepEqual(events, []);
    fs.writeFileSync(path.join(item.oldRelease, ".relay-revision"), "bad-marker\n");
    assert.throws(() => updater.currentRevision(path.join(item.directory, "current")), /invalid/);
  } finally { item.close(); }
});

test("validated build switches atomically after checks and preserves queue data", async () => {
  const item = fixture();
  try {
    const { dependencies, events } = runner(item);
    assert.deepEqual(await updater.runUpdate(item.config, dependencies), { status: "updated", revision: newRevision });
    assert.deepEqual(events, ["checkout", "ci --no-audit --no-fund", "run prisma:generate", "run build:server", "tests", "probe", "help", "stop", "start"]);
    assert.equal(fs.realpathSync(path.join(item.directory, "current")), path.join(item.directory, "releases", newRevision));
    assert.equal(fs.readFileSync(path.join(item.directory, "queue-sentinel"), "utf8"), "uncertain stays uncertain\n");
    assert.equal(fs.existsSync(path.join(item.directory, "update-transaction.json")), false);
    assert.equal(fs.existsSync(path.join(item.directory, "update-lock")), false);
  } finally { item.close(); }
});

test("build and fixed compatibility-probe failures never stop the current relay", async () => {
  for (const settings of [{ failBuild: true }, { failProbe: true }]) {
    const item = fixture();
    try {
      const { dependencies, events } = runner(item, settings);
      await assert.rejects(updater.runUpdate(item.config, dependencies), /candidate.*failed/);
      assert.equal(events.includes("stop"), false);
      assert.equal(fs.realpathSync(path.join(item.directory, "current")), item.oldRelease);
      assert.deepEqual(fs.readdirSync(path.join(item.directory, "releases")), [oldRevision]);
    } finally { item.close(); }
  }
});

test("failed candidate activation restores and restarts the previous release", async () => {
  const item = fixture();
  try {
    const { dependencies, events } = runner(item, { failCandidateStart: true });
    await assert.rejects(updater.runUpdate(item.config, dependencies), /previous release restored/);
    assert.equal(fs.realpathSync(path.join(item.directory, "current")), item.oldRelease);
    assert.deepEqual(events.slice(-4), ["stop", "start", "stop", "start"]);
    assert.equal(fs.existsSync(path.join(item.directory, "update-transaction.json")), false);
    assert.equal(fs.existsSync(path.join(item.directory, "releases", newRevision, ".relay-update-failed")), true);
    const second = runner(item);
    await assert.rejects(updater.runUpdate(item.config, second.dependencies), /previously failed activation/);
    assert.deepEqual(second.events, []);
    fs.unlinkSync(path.join(item.directory, "releases", newRevision, ".relay-update-failed"));
    assert.deepEqual(await updater.runUpdate(item.config, second.dependencies), { status: "updated", revision: newRevision });
    assert.deepEqual(second.events, ["tests", "probe", "help", "stop", "start"]);
  } finally { item.close(); }
});

test("an interrupted switch is restored before checking the remote branch", async () => {
  const item = fixture();
  try {
    const candidate = path.join(item.directory, "releases", newRevision);
    fs.mkdirSync(candidate);
    fs.unlinkSync(path.join(item.directory, "current"));
    fs.symlinkSync(candidate, path.join(item.directory, "current"));
    fs.writeFileSync(path.join(item.directory, "update-transaction.json"), JSON.stringify({ previousPath: item.oldRelease, candidatePath: candidate }));
    const { dependencies, events } = runner(item, { revision: oldRevision });
    assert.deepEqual(await updater.runUpdate(item.config, dependencies), { status: "unchanged", revision: oldRevision });
    assert.deepEqual(events, ["stop", "start"]);
    assert.equal(fs.realpathSync(path.join(item.directory, "current")), item.oldRelease);
  } finally { item.close(); }
});

test("startup validation requires a new PID and a sustained active service", async () => {
  const item = fixture();
  try {
    const { dependencies } = runner(item);
    const baseRun = dependencies.run;
    let starts = 0;
    let stops = 0;
    dependencies.run = async (command, args, options) => {
      if (command === "systemctl" && args[1] === "start") starts += 1;
      if (command === "systemctl" && args[1] === "stop") stops += 1;
      if (command === "systemctl" && args[1] === "show" && starts === 1 && stops === 1) return { stdout: "ActiveState=active\nMainPID=100\nNRestarts=0\n" };
      return baseRun(command, args, options);
    };
    await assert.rejects(updater.runUpdate(item.config, dependencies), /previous release restored/);
    assert.equal(starts, 2);
    assert.equal(fs.realpathSync(path.join(item.directory, "current")), item.oldRelease);
  } finally { item.close(); }
});
