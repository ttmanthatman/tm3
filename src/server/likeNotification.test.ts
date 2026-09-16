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

test("favorite notifications are filtered server-side once dismissed", () => {
  const route = server.match(/app\.get\("\/api\/like-notifications"[\s\S]*?\n\}\);/);
  assert.ok(route);
  const favoriteQuery = route[0].match(/prisma\.messageFavorite\.findMany\(\{[\s\S]*?\n    \}\)/);
  assert.ok(favoriteQuery);
  assert.match(favoriteQuery[0], /dismissedAt: null/);
});

test("dismissing a favorite notification requires ownership and records dismissedAt", () => {
  const route = server.match(/app\.patch\("\/api\/favorite-notifications\/:id\/dismiss"[\s\S]*?\n\}\);/);
  assert.ok(route);
  assert.match(route[0], /preHandler: requireAuth/);
  assert.match(route[0], /favorite\.message\.sender\.accountId !== auth\.accountId/);
  assert.match(route[0], /reply\.code\(404\)/);
  assert.match(route[0], /prisma\.messageFavorite\.update\(\{ where: \{ id \}, data: \{ dismissedAt: new Date\(\) \} \}\)/);
});

test("the favorites collection is not narrowed by notification dismissal", () => {
  const route = server.match(/app\.get\("\/api\/favorites"[\s\S]*?\n\}\);/);
  assert.ok(route);
  assert.doesNotMatch(route[0], /dismissedAt/);
});
