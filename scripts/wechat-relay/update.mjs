#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const REVISION = /^[a-f0-9]{40}$/;
const compatibilityProbe = `
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const root = process.cwd();
const { ManagedTeamChatSource } = await import(pathToFileURL(path.join(root, 'dist/server/scripts/wechat-relay/managedSource.js')));
const { formatRelayMessage } = await import(pathToFileURL(path.join(root, 'dist/server/scripts/wechat-relay/formatter.js')));
const base = { id: 1, channelId: 7, sender: { id: 3, kind: 'human', username: 'relay_probe', displayName: 'Relay probe' }, content: '', type: 'text', createdAt: new Date().toISOString() };
const source = new ManagedTeamChatSource('https://relay-probe.invalid', 'not-a-device-token', async () => Response.json({ messages: [base, { ...base, id: 2, type: 'future_relay_probe', relayText: 'Forward-compatible relay probe' }] }));
try {
  const messages = await source.fetchAfter(0);
  assert.equal(messages.length, 2);
  assert.equal(formatRelayMessage(messages[1]), 'Forward-compatible relay probe');
} finally { source.close(); }
`;

export function loadUpdateConfig(environment = process.env) {
  const repository = environment.RELAY_UPDATE_REPOSITORY;
  if (!repository) throw new Error("Set RELAY_UPDATE_REPOSITORY in the updater configuration");
  const url = new URL(repository);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("RELAY_UPDATE_REPOSITORY must be an HTTPS URL without credentials, query, or fragment");
  }
  const branch = environment.RELAY_UPDATE_BRANCH || "main";
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(branch) || branch.includes("..") || branch.endsWith("/") || branch.endsWith(".lock")) {
    throw new Error("RELAY_UPDATE_BRANCH must name one fixed repository branch");
  }
  const home = environment.HOME || os.homedir();
  const stateDirectory = environment.RELAY_UPDATE_STATE_DIRECTORY || path.join(home, ".local/share/wechat-relay");
  if (!path.isAbsolute(stateDirectory)) throw new Error("RELAY_UPDATE_STATE_DIRECTORY must be absolute");
  const service = environment.RELAY_UPDATE_SERVICE || "wechat-relay.service";
  if (!/^[A-Za-z0-9][A-Za-z0-9_.@-]*\.service$/.test(service) || service === "wechat-relay-update.service") {
    throw new Error("RELAY_UPDATE_SERVICE must name the relay service");
  }
  const node = environment.RELAY_UPDATE_NODE || process.execPath;
  if (!path.isAbsolute(node)) throw new Error("RELAY_UPDATE_NODE must be an absolute executable path");
  const startTimeoutMs = Number(environment.RELAY_UPDATE_START_TIMEOUT_MS || 30000);
  if (!Number.isInteger(startTimeoutMs) || startTimeoutMs < 5000 || startTimeoutMs > 300000) {
    throw new Error("RELAY_UPDATE_START_TIMEOUT_MS must be between 5000 and 300000");
  }
  // Build subprocesses receive no relay credential or database configuration.
  const buildEnvironment = Object.fromEntries(
    ["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TMPDIR"]
      .flatMap((key) => environment[key] ? [[key, environment[key]]] : [])
  );
  return {
    repository: url.toString(), branch, stateDirectory, service, node, startTimeoutMs,
    buildEnvironment: { ...buildEnvironment, CI: "1", GIT_TERMINAL_PROMPT: "0", DATABASE_URL: "mysql://build:build@127.0.0.1:3306/relay_build_only" },
    serviceEnvironment: {
      ...buildEnvironment,
      ...Object.fromEntries(["XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"].flatMap((key) => environment[key] ? [[key, environment[key]]] : []))
    }
  };
}

export function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd, env: options.env, shell: false,
      stdio: ["ignore", "pipe", "pipe"], timeout: options.timeoutMs || 120000
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk.toString()).slice(-12000); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-12000); });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(command)} failed (${signal || code}): ${(stderr || stdout).trim().slice(-6000)}`));
    });
  });
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== "ESRCH"; }
}

export function acquireUpdateLock(stateDirectory) {
  fs.mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  const directory = path.join(stateDirectory, "update-lock");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.mkdirSync(directory, { mode: 0o700 });
      fs.writeFileSync(path.join(directory, "pid"), `${process.pid}\n`, { mode: 0o600 });
      return () => fs.rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let pid = Number.NaN;
      try { pid = Number(fs.readFileSync(path.join(directory, "pid"), "utf8").trim()); }
      catch (readError) { if (readError.code !== "ENOENT") throw readError; }
      // A new lock without its PID belongs to an updater still acquiring it.
      if (processIsAlive(pid) || (!Number.isInteger(pid) && Date.now() - fs.statSync(directory).mtimeMs < 60000)) {
        throw new Error("Another relay update is already running");
      }
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
  throw new Error("Unable to acquire the relay update lock");
}

export function currentRevision(currentPath) {
  const target = fs.realpathSync(currentPath);
  const marker = path.join(target, ".relay-revision");
  if (fs.existsSync(marker)) {
    const revision = fs.readFileSync(marker, "utf8").trim();
    if (!REVISION.test(revision)) throw new Error("Current release has an invalid .relay-revision marker");
    return revision;
  }
  const name = path.basename(target);
  return REVISION.test(name) ? name : null;
}

function replaceCurrent(currentPath, target) {
  const temporary = `${currentPath}.next-${process.pid}`;
  try {
    fs.symlinkSync(target, temporary, "dir");
    fs.renameSync(temporary, currentPath);
  } finally { fs.rmSync(temporary, { force: true }); }
}

function readService(stdout) {
  const properties = Object.fromEntries(stdout.trim().split("\n").map((line) => line.split("=", 2)));
  return { state: properties.ActiveState, pid: Number(properties.MainPID || 0), restarts: Number(properties.NRestarts || 0) };
}

function findRelayTests(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? findRelayTests(fullPath) : entry.name.endsWith(".test.ts") ? [fullPath] : [];
  }).sort();
}

export async function runUpdate(config, dependencies = {}) {
  const run = dependencies.run || runCommand;
  const sleep = dependencies.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = dependencies.now || Date.now;
  const log = dependencies.log || ((message) => console.log(`[relay-update] ${message}`));
  const releaseLock = acquireUpdateLock(config.stateDirectory);
  const stateDirectory = fs.realpathSync(config.stateDirectory);
  const current = path.join(stateDirectory, "current");
  const transactionPath = path.join(stateDirectory, "update-transaction.json");
  const releases = path.join(stateDirectory, "releases");
  const cache = path.join(stateDirectory, "source.git");
  const commandOptions = { cwd: stateDirectory, env: config.buildEnvironment };
  const serviceOptions = { cwd: stateDirectory, env: config.serviceEnvironment };
  const serviceCommand = (verb) => run("systemctl", ["--user", verb, config.service], serviceOptions);
  const serviceStatus = async () => readService((await run("systemctl", ["--user", "show", config.service, "--property=ActiveState", "--property=MainPID", "--property=NRestarts"], serviceOptions)).stdout);
  const waitForStart = async (previousPid) => {
    const deadline = now() + config.startTimeoutMs;
    let healthySince = null;
    let healthyPid = 0;
    let healthyRestarts = 0;
    while (now() <= deadline) {
      const status = await serviceStatus();
      if (status.state === "active" && status.pid > 0 && status.pid !== previousPid) {
        if (healthySince === null || healthyPid !== status.pid || healthyRestarts !== status.restarts) {
          healthySince = now(); healthyPid = status.pid; healthyRestarts = status.restarts;
        }
        if (now() - healthySince >= 5000) return status.pid;
      } else healthySince = null;
      await sleep(1000);
    }
    throw new Error("Relay service did not remain active with a new process after restart");
  };
  const stopAndConfirm = async () => {
    await serviceCommand("stop");
    const status = await serviceStatus();
    if (status.pid !== 0 || !["inactive", "failed"].includes(status.state)) {
      throw new Error("Relay service has not stopped; release switch cancelled");
    }
  };
  const restore = async (transaction) => {
    if (!transaction || typeof transaction.previousPath !== "string" || typeof transaction.candidatePath !== "string"
      || !path.isAbsolute(transaction.previousPath) || !path.isAbsolute(transaction.candidatePath)
      || !fs.statSync(transaction.previousPath).isDirectory()) throw new Error("Invalid interrupted-update transaction");
    const existing = fs.realpathSync(current);
    const previousPath = fs.realpathSync(transaction.previousPath);
    const candidatePath = fs.realpathSync(transaction.candidatePath);
    if (existing !== previousPath && existing !== candidatePath) {
      throw new Error("Current release changed outside the updater; automatic rollback cancelled");
    }
    const previousPid = (await serviceStatus()).pid;
    await stopAndConfirm();
    replaceCurrent(current, previousPath);
    await serviceCommand("start");
    await waitForStart(previousPid);
    fs.rmSync(transactionPath);
    log("Previous relay release restored");
  };
  let staging;
  try {
    if (!fs.lstatSync(current).isSymbolicLink()) throw new Error("Install the managed current release symlink before enabling updates");
    if (fs.existsSync(transactionPath)) await restore(JSON.parse(fs.readFileSync(transactionPath, "utf8")));
    fs.mkdirSync(releases, { recursive: true });
    if (!fs.existsSync(cache)) await run("git", ["init", "--bare", cache], commandOptions);
    await run("git", ["--git-dir", cache, "fetch", "--no-tags", "--depth=1", config.repository, `refs/heads/${config.branch}`], commandOptions);
    const revision = (await run("git", ["--git-dir", cache, "rev-parse", "--verify", "FETCH_HEAD^{commit}"], commandOptions)).stdout.trim();
    if (!REVISION.test(revision)) throw new Error("Fetched revision is not a full Git commit SHA");
    if (currentRevision(current) === revision) {
      log(`Relay is already at ${revision}`);
      return { status: "unchanged", revision };
    }
    const candidate = path.join(releases, revision);
    const failedMarker = path.join(candidate, ".relay-update-failed");
    const existingCandidate = fs.existsSync(candidate);
    if (existingCandidate && fs.existsSync(failedMarker)) {
      throw new Error(`This revision previously failed activation. Inspect ${failedMarker} and the user service logs; after repairing the cause, remove that marker to revalidate, or publish a newer revision`);
    }
    if (existingCandidate && currentRevision(candidate) !== revision) throw new Error("Existing candidate has an invalid revision marker; inspect its release directory");
    if (!existingCandidate) {
      staging = path.join(releases, `${revision}.staging-${process.pid}`);
      fs.mkdirSync(staging, { mode: 0o700 });
      log(`Building ${revision} while the current relay keeps running`);
      await run("git", ["--git-dir", cache, "--work-tree", staging, "checkout", "--force", revision, "--", "."], commandOptions);
      const buildOptions = { cwd: staging, env: config.buildEnvironment, timeoutMs: 1200000 };
      await run("npm", ["ci", "--no-audit", "--no-fund"], buildOptions);
      await run("npm", ["run", "prisma:generate"], buildOptions);
      await run("npm", ["run", "build:server"], buildOptions);
    }
    const validationDirectory = staging || candidate;
    const buildOptions = { cwd: validationDirectory, env: config.buildEnvironment, timeoutMs: 1200000 };
    const tests = findRelayTests(path.join(validationDirectory, "src/scripts/wechat-relay"));
    if (!tests.length) throw new Error("Candidate has no relay regression tests");
    await run(config.node, ["--import", "tsx", "--test", ...tests], buildOptions);
    await run(config.node, ["--input-type=module", "--eval", compatibilityProbe], buildOptions);
    await run(config.node, ["dist/server/scripts/wechat-relay/main.js", "help"], buildOptions);
    if (!fs.existsSync(path.join(validationDirectory, "scripts/wechat-relay/update.mjs"))) throw new Error("Candidate is missing the updater entry point");
    if (staging) {
      fs.writeFileSync(path.join(staging, ".relay-revision"), `${revision}\n`, { mode: 0o600 });
      fs.renameSync(staging, candidate);
      staging = undefined;
    }
    const previousPath = fs.realpathSync(current);
    const oldPid = (await serviceStatus()).pid;
    const transaction = { previousPath, candidatePath: candidate };
    fs.writeFileSync(`${transactionPath}.next`, `${JSON.stringify(transaction)}\n`, { mode: 0o600 });
    fs.renameSync(`${transactionPath}.next`, transactionPath);
    try {
      await stopAndConfirm();
      replaceCurrent(current, candidate);
      await serviceCommand("start");
      const pid = await waitForStart(oldPid);
      fs.rmSync(transactionPath);
      log(`Activated ${revision} with relay PID ${pid}`);
      return { status: "updated", revision };
    } catch (error) {
      fs.writeFileSync(failedMarker, `${error.message}\n`, { mode: 0o600 });
      try { await restore(transaction); }
      catch (rollbackError) { throw new AggregateError([error, rollbackError], "Relay update and rollback failed; inspect the user service before retrying"); }
      throw new Error(`Relay update failed; previous release restored: ${error.message}`, { cause: error });
    }
  } finally {
    if (staging) fs.rmSync(staging, { recursive: true, force: true });
    releaseLock();
  }
}

async function main() {
  if (["--help", "help", "-h"].includes(process.argv[2])) {
    console.log("Usage: update.mjs (configuration: ~/.config/wechat-relay/update.env)");
    return;
  }
  await runUpdate(loadUpdateConfig());
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[relay-update] ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof AggregateError) for (const cause of error.errors) console.error(cause instanceof Error ? cause.message : String(cause));
    process.exitCode = 1;
  });
}
