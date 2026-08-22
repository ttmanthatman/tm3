import assert from "node:assert/strict";
import test from "node:test";
import { createRelaySetupServer } from "./setupApp.js";

const token = "Y0aL1_7wXQrj4KwdVSgBePJ1WBACfTPb5Sw9UC9GV7A";

test("setup app stays local, protects writes, and never renders the current token", async (context) => {
  const calls: string[] = [];
  const { server, secret } = createRelaySetupServer({
    existingEnvironment: `RELAY_BASE_URL=https://old.example.com\nRELAY_AGENT_TOKEN=${token}\n`,
    validateConnection: async (connection) => { calls.push(`validate:${connection.baseUrl}`); },
    applyConnection: async (connection) => { calls.push(`apply:${connection.databasePath}`); }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  context.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const pageUrl = `${origin}/${secret}/`;

  const page = await fetch(pageUrl);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /https:\/\/old\.example\.com/);
  assert.doesNotMatch(html, new RegExp(token));

  const rejected = await fetch(`${pageUrl}connect`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://attacker.invalid" },
    body: JSON.stringify({ baseUrl: "https://production.example.com", token })
  });
  assert.equal(rejected.status, 403);
  assert.deepEqual(calls, []);

  const connected = await fetch(`${pageUrl}connect`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ baseUrl: "https://production.example.com", token })
  });
  assert.equal(connected.status, 200);
  assert.equal(calls[0], "validate:https://production.example.com");
  assert.match(calls[1], /^apply:\/var\/lib\/wechat-relay\/relay-production\.example\.com-/);
});
