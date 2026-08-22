import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyUserRelayConnection,
  resolveRelaySetupEnvironmentPath,
  userRelayEnvironmentPath
} from "./setupUserService.js";

const connection = {
  baseUrl: "https://production.example.com",
  token: "Y0aL1_7wXQrj4KwdVSgBePJ1WBACfTPb5Sw9UC9GV7A",
  databasePath: "/var/lib/wechat-relay/relay-production.sqlite"
};

test("setup discovers an existing per-user relay environment", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-relay-user-"));
  const systemPath = path.join(directory, "missing-system.env");
  const userPath = userRelayEnvironmentPath(directory);
  fs.mkdirSync(path.dirname(userPath), { recursive: true });
  fs.writeFileSync(userPath, "RELAY_BASE_URL=https://old.example.com\n", { mode: 0o600 });
  try {
    assert.equal(resolveRelaySetupEnvironmentPath(systemPath, directory), userPath);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("per-user setup updates atomically and keeps a backup", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-relay-user-"));
  const environmentPath = path.join(directory, "wechat-relay.env");
  const previous = "RELAY_BASE_URL=https://old.example.com\nRELAY_DRIVER=x11\n";
  fs.writeFileSync(environmentPath, previous, { mode: 0o600 });
  let restarts = 0;
  try {
    applyUserRelayConnection(connection, environmentPath, () => { restarts += 1; });
    const updated = fs.readFileSync(environmentPath, "utf8");
    assert.match(updated, /RELAY_BASE_URL=https:\/\/production\.example\.com/);
    assert.match(updated, /RELAY_AGENT_TOKEN=Y0aL1_/);
    assert.match(updated, /RELAY_DATABASE_PATH=\/var\/lib\/wechat-relay\/relay-production\.sqlite/);
    assert.match(updated, /RELAY_DRIVER=x11/);
    assert.equal(fs.readFileSync(`${environmentPath}.before-setup`, "utf8"), previous);
    assert.equal(restarts, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("per-user setup restores the original configuration when restart fails", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-relay-user-"));
  const environmentPath = path.join(directory, "wechat-relay.env");
  const previous = "RELAY_BASE_URL=https://old.example.com\n";
  fs.writeFileSync(environmentPath, previous, { mode: 0o600 });
  let restarts = 0;
  try {
    assert.throws(() => applyUserRelayConnection(connection, environmentPath, () => {
      restarts += 1;
      throw new Error("restart failed");
    }), /restart failed/);
    assert.equal(fs.readFileSync(environmentPath, "utf8"), previous);
    assert.equal(restarts, 2);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
