import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeRelaySetupBaseUrl,
  relayDatabasePath,
  resolveRelaySetupInput,
  updateRelayEnvironment
} from "./setupConfig.js";

const token = "Y0aL1_7wXQrj4KwdVSgBePJ1WBACfTPb5Sw9UC9GV7A";

test("setup accepts the two-line configuration copied from the admin page", () => {
  const result = resolveRelaySetupInput({
    connectionText: `RELAY_BASE_URL=https://liao.example.com/\nRELAY_AGENT_TOKEN=${token}`
  });
  assert.equal(result.baseUrl, "https://liao.example.com");
  assert.equal(result.token, token);
  assert.match(result.databasePath, /^\/var\/lib\/wechat-relay\/relay-liao\.example\.com-[a-f0-9]{12}\.sqlite$/);
});

test("setup accepts a token by itself and reuses the existing site address", () => {
  const result = resolveRelaySetupInput(
    { connectionText: token },
    "RELAY_BASE_URL=https://liao.example.com\nRELAY_DRIVER=x11\n"
  );
  assert.equal(result.baseUrl, "https://liao.example.com");
  assert.equal(result.token, token);
});

test("setup rejects unsafe addresses and malformed tokens", () => {
  assert.throws(() => normalizeRelaySetupBaseUrl("http://liao.example.com"), /HTTPS/);
  assert.throws(() => normalizeRelaySetupBaseUrl("https://user:pass@liao.example.com"), /用户名或密码/);
  assert.throws(() => normalizeRelaySetupBaseUrl("https://liao.example.com?a=1"), /查询参数/);
  assert.throws(
    () => resolveRelaySetupInput({ baseUrl: "https://liao.example.com", token: "too-short" }),
    /24–256/
  );
});

test("setup preserves unrelated environment settings and removes duplicate managed keys", () => {
  const connection = resolveRelaySetupInput({ baseUrl: "https://liao.example.com", token });
  const updated = updateRelayEnvironment(
    "# visible WeChat\nRELAY_BASE_URL=https://demo.example.com\nRELAY_DRIVER=x11\nRELAY_AGENT_TOKEN=old-token\nRELAY_BASE_URL=https://duplicate.example.com\n",
    connection
  );
  assert.match(updated, /^# visible WeChat/m);
  assert.match(updated, /^RELAY_DRIVER=x11$/m);
  assert.equal((updated.match(/^RELAY_BASE_URL=/gm) || []).length, 1);
  assert.equal((updated.match(/^RELAY_AGENT_TOKEN=/gm) || []).length, 1);
  assert.equal((updated.match(/^RELAY_DATABASE_PATH=/gm) || []).length, 1);
  assert.match(updated, new RegExp(`^RELAY_AGENT_TOKEN=${token}$`, "m"));
});

test("each site receives an independent queue database", () => {
  assert.notEqual(
    relayDatabasePath("https://demo.example.com"),
    relayDatabasePath("https://production.example.com")
  );
});
