import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const server = fs.readFileSync(new URL("./index.ts", import.meta.url), "utf8");

test("admin account deletion protects the active and final administrator", () => {
  assert.match(server, /app\.delete\("\/api\/admin\/accounts\/:id", \{ preHandler: requireAdmin \}/);
  assert.match(server, /id === auth\.accountId[\s\S]*?不能删除当前登录的管理员账号/);
  assert.match(server, /otherAdmins[\s\S]*?至少需要保留一个管理员/);
});

test("account deletion preserves historic messages while revoking live access", () => {
  assert.match(server, /tx\.actor\.update\([\s\S]*?accountId: null[\s\S]*?status: "deleted"/);
  assert.match(server, /displayName: `\$\{account\.displayName\}（已删除用户）`/);
  assert.match(server, /tx\.account\.delete\(\{ where: \{ id \} \}\)/);
  assert.match(server, /disconnectSessions\(account\.sessions\.map/);
  assert.match(server, /action: "account-deleted"/);
});
