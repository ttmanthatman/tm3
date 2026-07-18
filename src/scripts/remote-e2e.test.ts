import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const hostname = "demo.xiaogushi.us";
const username = "remote_e2e";
const channel = "远程冒烟测试";

function validEnvironment() {
  return {
    REMOTE_E2E_BASE_URL: `https://${hostname}`,
    REMOTE_E2E_USERNAME: username,
    REMOTE_E2E_PASSWORD: "safe-remote-e2e-password-12345",
    REMOTE_E2E_CHANNEL: channel
  };
}

test("remote browser smoke accepts only the dedicated test site, account, and channel", () => {
  const probe = 'import { remoteE2EEnvironment } from "./e2e-remote/safety.ts"; remoteE2EEnvironment();';
  const accepted = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", probe], {
    cwd: root,
    env: { ...process.env, ...validEnvironment() },
    encoding: "utf8"
  });
  assert.equal(accepted.status, 0, accepted.stderr);
  for (const environment of [
    { ...validEnvironment(), REMOTE_E2E_BASE_URL: "https://example.com" },
    { ...validEnvironment(), REMOTE_E2E_BASE_URL: `http://${hostname}` },
    { ...validEnvironment(), REMOTE_E2E_USERNAME: "administrator" },
    { ...validEnvironment(), REMOTE_E2E_CHANNEL: "普通频道" },
    { ...validEnvironment(), REMOTE_E2E_PASSWORD: "too-short" }
  ]) {
    const rejected = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", probe], {
      cwd: root,
      env: { ...process.env, ...environment },
      encoding: "utf8"
    });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /Remote E2E safety check failed/);
  }
});

test("remote browser smoke ignores credentials and failure artifacts and contains no data reset commands", () => {
  const runner = fs.readFileSync(path.join(root, "scripts/run-e2e-remote.sh"), "utf8");
  const config = fs.readFileSync(path.join(root, "playwright.remote.config.ts"), "utf8");
  const remoteSources = fs.readdirSync(path.join(root, "e2e-remote"))
    .filter((file) => file.endsWith(".ts"))
    .map((file) => fs.readFileSync(path.join(root, "e2e-remote", file), "utf8"));
  const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
  assert.match(runner, /\.env\.remote-e2e\.local/);
  assert.match(runner, /remoteE2EEnvironment/);
  assert.match(config, /retain-on-failure/);
  assert.match(config, /only-on-failure/);
  assert.match(config, /output\/e2e-remote/);
  assert.match(gitignore, /^\.env\.remote-e2e\.local$/m);
  assert.match(gitignore, /^output\/e2e-remote\/$/m);
  for (const forbidden of [/migrate reset/i, /db push/i, /deleteMany/i, /truncate/i, /\bdrop\b/i, /seed/i]) {
    assert.doesNotMatch(runner, forbidden);
    for (const source of remoteSources) assert.doesNotMatch(source, forbidden);
  }
});
