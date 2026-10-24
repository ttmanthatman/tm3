import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const demoHostname = "demo.xiaogushi.us";
const azureHostname = "azure-liao.xiaogushi.us";
const username = "remote_e2e";
const channel = "远程冒烟测试";

function validEnvironment() {
  return {
    REMOTE_E2E_PROFILE: "demo",
    REMOTE_E2E_BASE_URL: `https://${demoHostname}`,
    REMOTE_E2E_USERNAME: username,
    REMOTE_E2E_PASSWORD: "safe-remote-e2e-password-12345",
    REMOTE_E2E_CHANNEL: channel
  };
}

function runProbe(probe: string, env: Record<string, string | undefined>) {
  return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", probe], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8"
  });
}

test("remote browser smoke accepts only the dedicated test site, account, and channel", () => {
  const probe = 'import { remoteE2EEnvironment } from "./e2e-remote/safety.ts"; remoteE2EEnvironment();';
  const accepted = runProbe(probe, validEnvironment());
  assert.equal(accepted.status, 0, accepted.stderr);
  const rejections: Array<Record<string, string | undefined>> = [
    { ...validEnvironment(), REMOTE_E2E_PROFILE: undefined },
    { ...validEnvironment(), REMOTE_E2E_PROFILE: "production" },
    { ...validEnvironment(), REMOTE_E2E_BASE_URL: "https://example.com" },
    { ...validEnvironment(), REMOTE_E2E_BASE_URL: `https://${azureHostname}` },
    { ...validEnvironment(), REMOTE_E2E_BASE_URL: `http://${demoHostname}` },
    { ...validEnvironment(), REMOTE_E2E_BASE_URL: `https://user:pass@${demoHostname}` },
    { ...validEnvironment(), REMOTE_E2E_BASE_URL: `https://${demoHostname}:8443` },
    { ...validEnvironment(), REMOTE_E2E_BASE_URL: `https://${demoHostname}/login` },
    { ...validEnvironment(), REMOTE_E2E_USERNAME: "administrator" },
    { ...validEnvironment(), REMOTE_E2E_CHANNEL: "普通频道" },
    { ...validEnvironment(), REMOTE_E2E_PASSWORD: "too-short" }
  ];
  for (const environment of rejections) {
    const rejected = runProbe(probe, environment);
    assert.notEqual(rejected.status, 0, `expected rejection for ${JSON.stringify(environment)}`);
    assert.match(rejected.stderr, /Remote E2E safety check failed/);
  }
});

test("isApprovedRemoteRequest enforces one exact https/wss target for the selected profile", () => {
  const probe = `import assert from "node:assert/strict";
import { isApprovedRemoteRequest } from "./e2e-remote/safety.ts";
const demo = { REMOTE_E2E_PROFILE: "demo" };
const azure = { REMOTE_E2E_PROFILE: "azure" };
const approved = [
  ["https://${demoHostname}/api/health", demo],
  ["wss://${demoHostname}/socket.io/?EIO=4&transport=websocket", demo],
  ["https://${azureHostname}/api/health", azure],
  ["wss://${azureHostname}/socket.io/", azure]
];
const rejected = [
  ["https://${demoHostname}/api/health", azure],
  ["https://${azureHostname}/api/health", demo],
  ["https://example.com/", demo],
  ["https://${demoHostname}.evil.example/", demo],
  ["http://${demoHostname}/", demo],
  ["ws://${demoHostname}/socket.io/", demo],
  ["https://user:pass@${demoHostname}/", demo],
  ["wss://${demoHostname}:4443/socket.io/", demo],
  ["https://${demoHostname}/api/health", {}],
  ["https://${demoHostname}/api/health", { REMOTE_E2E_PROFILE: "production" }]
];
for (const [url, env] of approved) assert.equal(isApprovedRemoteRequest(url, env), true, "expected approved: " + url);
for (const [url, env] of rejected) assert.equal(isApprovedRemoteRequest(url, env), false, "expected rejected: " + url + " " + JSON.stringify(env));`;
  const result = runProbe(probe, {});
  assert.equal(result.status, 0, result.stderr);
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
