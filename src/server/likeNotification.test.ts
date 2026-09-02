import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const server = fs.readFileSync(new URL("./index.ts", import.meta.url), "utf8");

test("a new like notifies the message owner through socket and web push", () => {
  const route = server.match(/app\.put\("\/api\/messages\/:messageId\/like"[\s\S]*?return \{ success: true, reactions, notification \};/);
  assert.ok(route);
  assert.match(route[0], /emit\("message:liked", notification\)/);
  assert.match(route[0], /await sendLikePush\(message\.sender\.accountId, message\.channelId, messageId, notification\.likerName, pushOrigin\)/);
});

test("favorites notify the message owner and remove their notice when undone", () => {
  const route = server.match(/app\.put\("\/api\/messages\/:messageId\/favorite"[\s\S]*?return \{ success: true, reactions, notification \};/);
  assert.ok(route);
  assert.match(route[0], /emit\("message:favorited", notification\)/);
  assert.match(route[0], /emit\("message:favorite-removed", \{ id: existing\.id \}\)/);
});

test("notification bootstrap returns favorites separately for backward compatibility", () => {
  const route = server.match(/app\.get\("\/api\/like-notifications"[\s\S]*?\n\}\);/);
  assert.ok(route);
  assert.match(route[0], /Promise\.all\(\[/);
  assert.match(route[0], /favoriteNotifications: favoriteRows\.map/);
  assert.match(route[0], /favoriterName: favorite\.account\.displayName/);
});
