import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const css = fs.readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("./App.vue", import.meta.url), "utf8");

test("narrow viewports always switch the chat shell to one column", () => {
  assert.doesNotMatch(css, /@media \(max-width: 760px\) and \((?:hover|pointer):/);
  assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*?\.app-shell \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
});

test("mobile drawers stay above the chat header and their scrim", () => {
  assert.match(css, /\.chat-head \{[\s\S]*?z-index: 21;/);
  assert.match(css, /\.scrim \{[\s\S]*?z-index: 22;/);
  assert.match(css, /\.member-pane \{[\s\S]*?z-index: 23;/);
  assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*?\.channel-pane \{[\s\S]*?z-index: 23;/);
});

test("new-message jump is a compact translucent arrow centered above the composer", () => {
  assert.match(app, /class="new-message-jump"[\s\S]*?aria-label="跳到最新消息"[\s\S]*?<ArrowDown/);
  assert.doesNotMatch(app, /<ArrowDown :size="16" \/>\{\{ hasUnreadMessages/);
  assert.match(css, /\.new-message-jump \{[\s\S]*?left: 50%;[\s\S]*?width: 34px;[\s\S]*?height: 34px;[\s\S]*?background: rgba\(/);
});

test("like alerts use the top notice rail instead of a reading-area overlay", () => {
  assert.match(app, /likeNotificationToTopNotice\(/);
  assert.match(app, /activeTopNotice\.kind === 'like'[\s\S]*?关闭点赞提醒/);
  assert.doesNotMatch(app, /class="like-notification-stack"/);
});

test("favorites stays fixed above the profile while only channels scroll", () => {
  const channelListEnd = app.indexOf('</div>\n      <button class="channel-row favorites-entry"');
  const profileStart = app.indexOf('<footer class="profile-row">');

  assert.ok(channelListEnd >= 0, "favorites entry should follow the channel list");
  assert.ok(profileStart > channelListEnd, "favorites entry should stay above the profile controls");
  assert.match(css, /\.channel-list \{[\s\S]*?flex: 1 1 auto;[\s\S]*?overflow-y: auto;/);
  assert.match(css, /\.favorites-entry \{[\s\S]*?z-index: 6;[\s\S]*?flex: 0 0 auto;/);
  assert.match(css, /\.profile-row \{[\s\S]*?z-index: 7;[\s\S]*?flex: 0 0 auto;/);
});

test("favorites render in the main chat surface and support context jumps", () => {
  assert.match(app, /v-if="showFavorites" class="messages-viewport favorites-viewport"/);
  assert.match(app, /class="favorites-main-list"[\s\S]*?beginFavoriteLongPress\(favorite, \$event\)/);
  assert.match(app, /class="mini-btn secondary"[\s\S]*?openFavoriteMessage\(favorite\)[\s\S]*?查看上下文/);
  assert.match(app, /v-if="!showFavorites" class="composer"/);
  assert.match(css, /\.favorites-main-list \{[\s\S]*?width: min\(760px, 100%\);/);
});
