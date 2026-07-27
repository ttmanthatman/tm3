import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const css = fs.readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("./App.vue", import.meta.url), "utf8");
const store = fs.readFileSync(new URL("./store.ts", import.meta.url), "utf8");
const lyricsHeader = fs.readFileSync(new URL("./components/MusicLyricsHeader.vue", import.meta.url), "utf8");
const bibleWorkspace = fs.readFileSync(new URL("./components/BibleWorkspace.vue", import.meta.url), "utf8");
const overflowMarquee = fs.readFileSync(new URL("./components/OverflowMarquee.vue", import.meta.url), "utf8");
const adminAccountsPage = fs.readFileSync(new URL("./features/admin/AdminAccountsPage.vue", import.meta.url), "utf8");
const adminAccountsLogic = fs.readFileSync(new URL("./features/admin/useAdminAccounts.ts", import.meta.url), "utf8");
const musicPlayer = fs.readFileSync(new URL("./features/music/useMusicPlayer.ts", import.meta.url), "utf8");
const musicManager = fs.readFileSync(new URL("./features/music/MusicManager.vue", import.meta.url), "utf8");
const server = [
  fs.readFileSync(new URL("../server/index.ts", import.meta.url), "utf8"),
  fs.readFileSync(new URL("../server/routes/music.ts", import.meta.url), "utf8")
].join("\n");

test("narrow viewports always switch the chat shell to one column", () => {
  assert.doesNotMatch(css, /@media \(max-width: 760px\) and \((?:hover|pointer):/);
  assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*?\.app-shell \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
});

test("the message viewport and composer occupy separate chat grid rows", () => {
  const chatPaneRule = css.match(/\.chat-pane \{([^}]*)\}/)?.[1] ?? "";
  const messagesRule = css.match(/\.messages-viewport \{([^}]*)\}/)?.[1] ?? "";
  const composerRule = css.match(/\.composer \{([^}]*)\}/)?.[1] ?? "";

  assert.match(chatPaneRule, /grid-template-rows: auto auto auto auto minmax\(0, 1fr\) auto;/);
  assert.match(messagesRule, /grid-row: 5;/);
  assert.match(composerRule, /grid-row: 6;/);
});

test("Bible minus-one workspace keeps both search modes and the full catalog available", () => {
  assert.match(app, /<BibleWorkspace[\s\S]*?:send-passage="sendBiblePassage"[\s\S]*?@close="closeBibleWorkspace"/);
  assert.match(app, /handleBibleSwipeStart[\s\S]*?deltaX >= 64/);
  assert.match(app, /class="icon-btn bible-header-trigger"[\s\S]*?@click="openBibleWorkspace"/);
  assert.doesNotMatch(css, /@media \(max-width: 760px\) \{[\s\S]*?\.bible-header-trigger \{[\s\S]*?display: none;/);
  assert.match(bibleWorkspace, />主题检索<[\s\S]*?>文本检索</);
  assert.match(bibleWorkspace, /catalog\.oldTestament[\s\S]*?catalog\.newTestament/);
  assert.match(bibleWorkspace, /verseSegments\(item\.verse\.text, item\.matches\)[\s\S]*?<mark v-if="segment\.highlighted">/);
  assert.match(bibleWorkspace, /scrollTop < 220[\s\S]*?loadChapter\(first - 1, true\)[\s\S]*?loadChapter\(last \+ 1\)/);
  assert.match(bibleWorkspace, /loadBibleWorkspaceState[\s\S]*?saveBibleWorkspaceState/);
  assert.match(bibleWorkspace, />搜索历史<[\s\S]*?>清空</);
  assert.match(bibleWorkspace, /matchingTopicHistory[\s\S]*?查看历史[\s\S]*?追加生成/);
  assert.match(app, /<BibleWorkspace[\s\S]*?:account-id="store\.account\?\.id \|\| 0"/);
  assert.match(app, /class="inline-bible-reader-link"[\s\S]*?openBibleReferenceInWorkspace/);
  assert.match(bibleWorkspace, /defineExpose\(\{ openLookupContext \}\)/);
  assert.match(bibleWorkspace, /linkedTargetVerseKeys[\s\S]*?isTargetVerse/);
  assert.match(bibleWorkspace, /let catalogLoadPromise: Promise<void> \| null = null/);
  assert.match(bibleWorkspace, /if \(catalogLoadPromise\) \{[\s\S]*?await catalogLoadPromise;[\s\S]*?return;/);
});

test("Bible reader offers compact book, chapter, and verse jumps beside the resource link", () => {
  assert.match(bibleWorkspace, /aria-label="经文快速跳转"[\s\S]*?aria-label="选择圣经书卷"[\s\S]*?aria-label="选择章节"[\s\S]*?aria-label="选择经节"/);
  assert.match(bibleWorkspace, /<span class="bible-resource-link" title="资料">资<\/span>/);
  assert.doesNotMatch(bibleWorkspace, /bible-resource-link" href=/);
  assert.match(bibleWorkspace, /suppressReaderScrollUntil = Date\.now\(\) \+ 500/);
  assert.match(bibleWorkspace, /Date\.now\(\) < suppressReaderScrollUntil/);
});

test("user administration uses a searchable master-detail layout with guarded destructive actions", () => {
  assert.match(app, /<AdminAccountsPage v-else-if="adminPage === 'users'" @message="adminMsg = \$event" \/>/);
  assert.doesNotMatch(app, /\/api\/admin\/accounts/);
  assert.match(adminAccountsLogic, /adminAccountDeleteConfirmation[\s\S]*?警告：确定删除用户[\s\S]*?method: "DELETE"/);
  assert.match(adminAccountsPage, /class="admin-account-list-pane"[\s\S]*?class="admin-account-detail-pane"/);
  assert.match(adminAccountsPage, /placeholder="搜索用户……"[\s\S]*?data-testid="admin-account-row"/);
  assert.match(adminAccountsPage, /v-if="account\.id === store\.account\?\.id">当前账号/);
  assert.match(adminAccountsPage, /v-if="passwordOpen" class="admin-password-reset"/);
  assert.match(adminAccountsPage, /class="mini-btn danger-action"[\s\S]*?:disabled="!canDeleteAccount\(selectedAccount\) \|\| deletingAccountId !== null"/);
  assert.doesNotMatch(adminAccountsPage, /v-for="account in accounts"[\s\S]*?type="password"/);
  assert.match(css, /\.admin-accounts-workspace \{[\s\S]*?grid-template-columns: minmax\(250px, 31%\) minmax\(0, 1fr\);/);
  assert.match(css, /@media \(max-width: 700px\) \{[\s\S]*?\.admin-accounts-page\.mobile-detail-open \.admin-account-list-pane[\s\S]*?display: none;/);
});

test("chat subtitles scroll only when their rendered text overflows", () => {
  assert.match(app, /<OverflowMarquee[\s\S]*?:text="chatSubtitleText"/);
  assert.match(overflowMarquee, /contentElement\.scrollWidth - viewportElement\.clientWidth/);
  assert.match(overflowMarquee, /new ResizeObserver\(measureOverflow\)/);
  assert.match(overflowMarquee, /chatSubtitleMarquee[\s\S]*?translateX\(calc\(0px - var\(--overflow-distance\)\)\)/);
});

test("mobile drawers stay above the chat header and their scrim", () => {
  assert.match(css, /\.chat-head \{[\s\S]*?z-index: 21;/);
  assert.match(css, /\.scrim \{[\s\S]*?z-index: 22;/);
  assert.match(css, /\.member-pane \{[\s\S]*?z-index: 23;/);
  assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*?\.channel-pane \{[\s\S]*?z-index: 23;/);
});

test("pinned notices stay above chat content and retain their modal layer", () => {
  assert.match(css, /\.chat-pane > :where\(:not\(\.wallpaper-pan-background\):not\(\.parallax-background\):not\(\.modal-shell\):not\(\.music-lyrics-header\)\) \{[\s\S]*?z-index: 1;/);
  assert.match(css, /\.pinned-view-shell \{[\s\S]*?z-index: 50;/);
  assert.match(app, /class="modal-shell pinned-view-shell"[\s\S]*?class="primary-btn pinned-ack-btn"/);
});

test("panning wallpaper stays on its own compositor layer during mobile scrolling", () => {
  assert.match(app, /"--wallpaper-image": hasWallpaper\.value && !wallpaperPanActive\.value/);
  assert.doesNotMatch(app, /"--wallpaper-position": wallpaperPanActive\.value/);
  assert.match(app, /v-if="wallpaperPanActive"[\s\S]*?class="wallpaper-pan-background"[\s\S]*?:style="wallpaperPanLayerStyle"/);
  assert.match(app, /wallpaperPanImageWidth\.value = (?:next|bounds)\.imageWidth/g);
  assert.match(app, /pendingReadPositionRestore\.value \|\| loadingHistoryFromScroll \|\| loadingNewerFromScroll \|\| activeReadAnchor/);
  assert.match(css, /\.wallpaper-pan-background \{[\s\S]*?position: absolute;[\s\S]*?backface-visibility: hidden;[\s\S]*?will-change: transform;/);
  assert.match(css, /\.chat-pane > :where\(:not\(\.wallpaper-pan-background\):not\(\.parallax-background\)\) \{[\s\S]*?width: 100%;[\s\S]*?max-width: 100%;/);
});

test("music playback freezes panning wallpaper while keeping the song glyph spinning", () => {
  assert.match(app, /'music-low-power': musicPlaying && wallpaperPanActive/);
  assert.match(app, /'playback-paused': musicPlaying/);
  assert.match(app, /shouldAdvanceWallpaperPan\(\{[\s\S]*?musicPlaying: musicPlaying\.value/);
  assert.match(css, /\.wallpaper-pan-background\.ready:not\(\.playback-paused\) \{[\s\S]*?will-change: transform;/);
  assert.match(css, /\.music-player-trigger\.spinning \.music-player-glyph \{[\s\S]*?animation: musicDiscSpin/);
  assert.doesNotMatch(css, /\.app-shell\.music-low-power \.music-player-trigger\.spinning \.music-player-glyph/);
});

test("panning wallpaper stays visible while its dimensions load and retries transient failures", () => {
  const wallpaperPanCss = css.match(/\.wallpaper-pan-background \{([^}]*)\}/)?.[1] || "";
  assert.match(app, /const wallpaperPanImage = ref<HTMLImageElement \| null>\(null\)/);
  assert.match(app, /const wallpaperPanLayerStyle = computed\(\(\) => wallpaperPanReady\.value[\s\S]*?width: "100%"/);
  assert.match(app, /ref="wallpaperPanImage"[\s\S]*?:src="wallpaperPanImageSource"[\s\S]*?@load="handleWallpaperPanImageLoad"[\s\S]*?@error="handleWallpaperPanImageError"/);
  assert.match(app, /function handleWallpaperPanImageError[\s\S]*?wallpaperPanRetryKey\.value = attempt/);
  assert.doesNotMatch(app, /const image = new Image\(\)/);
  assert.match(wallpaperPanCss, /object-fit: cover;/);
  assert.doesNotMatch(wallpaperPanCss, /opacity: 0;/);
});

test("panning wallpaper re-observes the chat pane whenever the pane element mounts", () => {
  assert.match(app, /watch\(\s*chatPane,[\s\S]*?observeWallpaperPanViewport\(\);[\s\S]*?await resetWallpaperPan\(\)/);
});

test("appearance image picker previews uploaded backgrounds through the public route", () => {
  assert.match(app, /v-for="image in backgroundAttachmentOptions"[\s\S]*?:src="wallpaperUrl\(image\.fileName\)"/);
  assert.doesNotMatch(app, /v-for="image in backgroundAttachmentOptions"[\s\S]*?:src="image\.url"/);
});

test("new-message jump is a compact translucent arrow centered above the composer", () => {
  assert.match(app, /class="new-message-jump"[\s\S]*?aria-label="跳到最新消息"[\s\S]*?<ArrowDown/);
  assert.doesNotMatch(app, /<ArrowDown :size="16" \/>\{\{ hasUnreadMessages/);
  assert.match(css, /\.new-message-jump \{[\s\S]*?left: 50%;[\s\S]*?bottom: calc\(58px \+ var\(--keyboard-offset\)\);[\s\S]*?z-index: 7;[\s\S]*?width: 34px;[\s\S]*?height: 34px;[\s\S]*?background: rgba\(/);
  assert.doesNotMatch(css, /\.chat-pane > :not\([^\n]+\) \{/);
});

test("all file previews keep close at the upper right and download at the lower right", () => {
  assert.match(app, /class="preview-control preview-close"[\s\S]*?aria-label="关闭预览"[\s\S]*?<X/);
  assert.match(app, /class="preview-control preview-download"[\s\S]*?aria-label="下载"[\s\S]*?<Download/);
  assert.doesNotMatch(app, /class="image-preview-download"/);
  assert.match(css, /\.preview-close \{[\s\S]*?top: calc\(var\(--safe-top\) \+ 12px\);/);
  assert.match(css, /\.preview-download \{[\s\S]*?bottom: calc\(var\(--safe-bottom\) \+ 12px\);/);
});

test("audio attachments render their waveform player immediately without a collapsed state", () => {
  assert.match(app, /<template v-else-if="isAudioMessage\(row\.message\)">[\s\S]*?class="inline-audio-player"[\s\S]*?<ResponsiveAudioWaveform/);
  assert.match(app, /@seek="seekInlineAudio\(row\.message, \$event\)"/);
  assert.doesNotMatch(app, /isInlineAudioPlayerExpanded|expandInlineAudioPlayer|collapseInlineAudioPlayer|expandedAudioMessageIds/);
  assert.doesNotMatch(app, /audio-file-card/);
  assert.doesNotMatch(app, /class="media-preview-audio"/);
  assert.match(css, /\.inline-audio-player \{[\s\S]*?--audio-accent: #ff5500;[\s\S]*?width: min\(410px, 66vw\);/);
  assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*?\.inline-audio-player \{[\s\S]*?width: min\(330px, calc\(100vw - 106px\)\);/);
});

test("audio attachment headers omit the redundant decorative audio icon", () => {
  assert.doesNotMatch(app, /class="inline-audio-art"/);
  assert.match(css, /\.inline-audio-head \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.doesNotMatch(css, /\.inline-audio-art/);
});

test("inline audio waveform uses a responsive physical-pixel canvas and never escapes the bubble", () => {
  const waveformCss = css.match(/\.inline-audio-waveform \{([^}]*)\}/)?.[1] || "";
  assert.match(css, /\.inline-audio-player \{[\s\S]*?box-sizing: border-box;[\s\S]*?max-width: 100%;[\s\S]*?min-width: 0;/);
  assert.match(app, /import ResponsiveAudioWaveform from "\.\/components\/ResponsiveAudioWaveform\.vue"/);
  assert.match(waveformCss, /width: 100%;[\s\S]*?overflow: hidden;/);
  assert.doesNotMatch(waveformCss, /justify-content: space-between/);
});

test("audio messages with a score render an attached full-height clickable score preview", () => {
  assert.match(app, /'audio-score-cluster': isAudioMessage\(row\.message\)/);
  assert.match(app, /v-if="musicScorePreviewPage\(row\.message\)"[\s\S]*?class="music-score-inline-preview"/);
  assert.match(app, /openMusicScorePreview\(musicScorePreviewPage\(row\.message\)!, row\.message\.id\)/);
  assert.match(css, /\.audio-score-cluster \{[\s\S]*?display: flex;[\s\S]*?align-items: stretch;/);
  assert.match(css, /\.music-score-inline-preview \{[\s\S]*?align-self: stretch;/);
  assert.doesNotMatch(css, /\.music-score-inline-preview::after/);
  assert.doesNotMatch(css, /\.music-score-inline-preview:(?:hover|active) \{[\s\S]*?transform:/);
});

test("download confirmation uses a direct confirmation question", () => {
  assert.match(app, /<span>确定下载？<\/span>/);
  assert.doesNotMatch(app, /无法预览，下载？/);
});

test("direct chats present the peer in pairs and offer seven AI names for groups", () => {
  assert.match(server, /channel\._count\.members === 2[\s\S]*?member\.account\.id !== viewer\.accountId/);
  assert.match(server, /name: directPeer\?\.displayName \|\| channel\.name/);
  assert.match(server, /`\/avatars\/\$\{directPeer\.avatarPath\}`/);
  assert.match(server, /"\/api\/channels\/:id\/name-suggestions"[\s\S]*?generateDirectChatNameSuggestions/);
  assert.match(server, /ensureDirectGroupDefaultName\(channelId\)[\s\S]*?emitChannelMembersChanged/);
  assert.match(app, /channelNameSuggestions[\s\S]*?requestDirectChatNameSuggestions/);
  assert.match(app, /class="direct-name-option"[\s\S]*?\{\{ suggestion \}\}/);
  assert.match(app, /双人私聊的名称和图标会自动跟随对方的昵称与头像/);
});

test("private locks and online dots sit above unclipped avatar artwork", () => {
  assert.match(app, /class="private-channel-badge"[\s\S]*?<LockKeyhole/);
  assert.doesNotMatch(app, /class="private-channel-badge">私</);
  assert.match(css, /\.channel-icon \{[\s\S]*?overflow: visible;/);
  assert.match(css, /\.private-channel-badge \{[\s\S]*?z-index: 2;[\s\S]*?right: -4px;[\s\S]*?bottom: -4px;/);
  assert.match(css, /\.presence-avatar \{[\s\S]*?overflow: visible;/);
  assert.match(css, /\.presence-avatar > img \{[\s\S]*?border-radius: inherit;/);
  assert.match(css, /\.online-dot \{[\s\S]*?right: -3px;[\s\S]*?bottom: -3px;/);
});

test("chat channel rows show a capped unread badge pinned to the channel icon", () => {
  assert.match(app, /v-if="channel\.kind !== 'music' && unreadCountFor\(channel\.id\) > 0" class="channel-unread-badge"/);
  assert.match(app, /class="channel-unread-badge">\{\{ formatUnreadCount\(unreadCountFor\(channel\.id\)\) \}\}<\/span>/);
  assert.match(app, /function unreadCountFor\(channelId: number\) \{\s*return store\.unreadCounts\[channelId\] \?\? 0;/);
  assert.match(css, /\.channel-icon \{[\s\S]*?position: relative;/);
  assert.match(css, /\.channel-unread-badge \{[\s\S]*?position: absolute;[\s\S]*?top: -5px;[\s\S]*?right: -5px;[\s\S]*?border: 2px solid var\(--panel\);[\s\S]*?border-radius: 999px;[\s\S]*?background: #f04438;/);
});

test("unread badges increment from socket messages and clear when the channel opens", () => {
  assert.match(store, /socket\.on\("message:new"[\s\S]*?this\.noteUnreadMessage\(message\)/);
  assert.match(store, /if \(!prayerOnly\) this\.markChannelRead\(channelId\)/);
  assert.match(store, /await this\.seedUnreadCounts\(\)/);
  assert.match(server, /prisma\.message\.groupBy\(\{[\s\S]*?by: \["channelId"\][\s\S]*?_max: \{ id: true \}/);
  assert.match(server, /lastMessageId: lastMessageIds\?\.get\(channelId\) \?\? null/);
});

test("like alerts use the header status line instead of a reading-area overlay", () => {
  assert.match(app, /likeNotificationToTopNotice\(/);
  assert.match(app, /activeTopNotice\.kind === 'like'[\s\S]*?关闭点赞提醒/);
  assert.doesNotMatch(app, /class="like-notification-stack"/);
});

test("shine scans one vertical highlight fully across message text before restarting", () => {
  assert.match(css, /\.message-effect-shine \.message-text \{[\s\S]*?linear-gradient\(90deg,[\s\S]*?#6a6a6a 45%,[\s\S]*?#ffffff 50%,[\s\S]*?#6a6a6a 55%,[\s\S]*?background-size: 300% 100%;[\s\S]*?background-repeat: no-repeat;[\s\S]*?animation: messageShine 3\.6s linear infinite;/);
  assert.match(css, /@keyframes messageShine \{[\s\S]*?0% \{[\s\S]*?background-position: 100% 0;[\s\S]*?100% \{[\s\S]*?background-position: 0 0;/);
});

test("fly effects fully leave both sides of the viewport before looping", () => {
  assert.match(css, /@keyframes messageFly \{[\s\S]*?translateX\(-100vw\)[\s\S]*?translateX\(100vw\)/);
  assert.match(css, /@keyframes messageFlyReverse \{[\s\S]*?translateX\(100vw\)[\s\S]*?translateX\(-100vw\)/);
  assert.doesNotMatch(css, /@keyframes messageFly[\s\S]*?72vw/);
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
  assert.match(app, /:class="\{ 'favorite-image-card': favorite\.message\.type === 'image' \}"/);
  assert.doesNotMatch(app, /长按任意卡片查看原消息上下文/);
  assert.match(app, /class="mini-btn secondary"[\s\S]*?openFavoriteMessage\(favorite\)[\s\S]*?查看上下文/);
  assert.match(app, /v-if="!showingFavoriteSurface && !isMusicChannel" class="composer"/);
  assert.match(app, /<MusicManager[\s\S]*?embedded[\s\S]*?:tracks="musicTracks"[\s\S]*?@refresh-tracks="loadMusicTracks"/);
  assert.match(css, /\.favorites-main-list \{[\s\S]*?width: min\(620px, 100%\);/);
  assert.match(css, /\.favorite-image-card \{[\s\S]*?width: fit-content;[\s\S]*?justify-self: start;/);
  assert.match(css, /\.favorite-image-card \.favorite-message-content \{[\s\S]*?background: transparent;/);
  assert.match(app, /favorite\.message\.type === 'music_playlist'[\s\S]*?music-playlist-message-card[\s\S]*?openSharedMusicPlaylistFromTap\(favorite\.message\)/);
  assert.match(app, /async function removeFavorite[\s\S]*?window\.confirm\("取消收藏这条消息？"\)/);
});

test("Bible favorites share one source and render each passage body exactly once", () => {
  const surfaceStart = app.indexOf('v-else-if="showBibleFavorites"');
  const surfaceEnd = app.indexOf('<div\n        v-else', surfaceStart);
  const surface = app.slice(surfaceStart, surfaceEnd);
  assert.match(app, />经文收藏<\/b>/);
  assert.match(app, /:favorites="bibleFavorites"[\s\S]*?:update-favorites="updateBibleFavorites"/);
  assert.match(surface, /bibleFavoritePassages[\s\S]*?formatBibleFavoriteBody\(passage\.lookup\)/);
  assert.doesNotMatch(surface, /toggleBibleReference/);
  assert.match(app, /async function removeBibleFavoritePassage[\s\S]*?window\.confirm/);
  assert.match(bibleWorkspace, /BIBLE_FAVORITE_COLOR_PRESETS/);
  assert.match(bibleWorkspace, /class="bible-favorite-color-picker"[\s\S]*?收藏标线颜色/);
  assert.match(bibleWorkspace, /updateSelectedFavorites[\s\S]*?if \(remove\) \{[\s\S]*?clearVerseSelection\(\);[\s\S]*?targetVerse\.value = null;[\s\S]*?linkedTargetVerseKeys\.value = new Set\(\)/);
  assert.match(bibleWorkspace, /removeBibleFavoritePassage[\s\S]*?window\.confirm/);
});

test("avatar and channel images are pinned to their square masks without clipping presence badges", () => {
  assert.match(css, /\.channel-icon img \{[\s\S]*?position: absolute;[\s\S]*?inset: 0;[\s\S]*?width: 100%;[\s\S]*?height: 100%;/);
  assert.match(css, /\.avatar img \{[\s\S]*?position: absolute;[\s\S]*?inset: 0;[\s\S]*?width: 100%;[\s\S]*?height: 100%;/);
  assert.match(css, /\.presence-avatar \{[\s\S]*?overflow: visible;/);
});

test("opening the Bible unmounts every chat pane instead of only hiding it", () => {
  assert.match(app, /<aside v-if="!bibleOpen" class="channel-pane"/);
  assert.match(app, /<section v-if="!bibleOpen" ref="chatPane" class="chat-pane"/);
  assert.match(app, /<aside v-if="!bibleOpen" class="member-pane"/);
});

test("explicit context jumps win over saved read-position restoration", () => {
  assert.match(app, /pendingMessageJumpId = messageId;[\s\S]*?pendingReadPositionRestore\.value = false;[\s\S]*?switchVisibleChannel\(channelId\)/);
  assert.match(app, /if \(pendingMessageJumpId !== null\) \{[\s\S]*?pendingReadPositionRestore\.value = false;[\s\S]*?return;/);
  assert.match(app, /const contextOffset = Math\.min\(120,[\s\S]*?root\.scrollTo\(\{ top: Math\.max\(0, targetTop\), behavior: "auto" \}\)/);
  assert.match(app, /activeReadAnchor = \{[\s\S]*?messageId: id,[\s\S]*?offset: contextOffset,[\s\S]*?reconcileReadPositionAfterLayout\(\)/);
});

test("opening the music player starts or resumes playback without pausing an active song", () => {
  const openPlayer = app.match(/function openMusicPlayer\([^)]*\) \{([\s\S]*?)\n\}/)?.[1] || "";

  assert.doesNotMatch(openPlayer, /pauseMusic\(/);
  assert.match(openPlayer, /if \(!musicPlaying\.value\) void playCurrentMusic\(\);/);
});

test("expanded player keeps its main control on the clicked song-button axis", () => {
  assert.match(app, /@click\.stop="openMusicPlayer\(\$event\)"/);
  assert.match(app, /:style="musicPlayerAnchorStyle"/);
  assert.match(app, /class="music-player-transport"[\s\S]*?class="icon-btn music-main-control"/);
  assert.match(css, /\.music-player-bar \{[\s\S]*?grid-template-columns: minmax\(72px, calc\(var\(--music-player-anchor-x\) - 84px\)\) 168px minmax\(0, 1fr\);/);
  assert.match(css, /\.music-player-transport \{[\s\S]*?grid-column: 2;[\s\S]*?grid-row: 1;[\s\S]*?align-items: center;/);
  assert.match(css, /\.music-player-title \{[\s\S]*?grid-column: 1;[\s\S]*?grid-row: 1;/);
  assert.match(css, /\.music-player-tools \{[\s\S]*?grid-column: 3;[\s\S]*?grid-row: 1;/);
  assert.doesNotMatch(css, /\.music-player-head \{[\s\S]*?min-height: calc\(96px/);
});

test("mobile expanded player reserves intrinsic width for transport and tool buttons", () => {
  assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*?\.music-player-bar \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) max-content max-content;/);
});

test("mobile player tool buttons collapse to icons so the title keeps room", () => {
  assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*?\.music-favorites-only-btn \{[\s\S]*?width: 32px;/);
  assert.match(css, /\.music-favorites-only-btn span,\s*\.music-mode-label \{[\s\S]*?display: none;/);
  assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*?\.music-mode-btn \{[\s\S]*?width: 32px;/);
  assert.match(app, /class="music-mode-label">\{\{ musicPlaybackModeLabel\(\) \}\}<\/span>/);
});

test("mobile drawers and the music manager head respect the top safe area", () => {
  assert.match(css, /\.member-pane \{[\s\S]*?padding-top: var\(--safe-top\);/);
  assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*?\.music-manager-head \{[\s\S]*?padding-top: calc\(8px \+ var\(--safe-top\)\);/);
});

test("voice record strip hides once a preview is ready", () => {
  assert.match(app, /<div v-if="!audioPreviewUrl" class="record-strip"/);
});

test("music manager opens from the player bar instead of taking header space", () => {
  const playerStart = app.indexOf('<div v-if="musicPlayerExpanded" class="music-player-bar"');
  const playerEnd = app.indexOf("</header>", playerStart);
  const player = app.slice(playerStart, playerEnd);

  assert.match(player, /class="music-mode-btn active"[\s\S]*?@click="cycleMusicPlaybackMode"/);
  assert.match(player, /aria-label="音乐管理"/);
  assert.match(player, /@click="toggleMusicManager"/);
  assert.match(app, /<MusicManager\s+v-if="musicManagerOpen"/);
});

test("music favorites persist per account and can constrain the playback queue", () => {
  assert.match(app, /class="icon-btn music-favorite-control"[\s\S]*?@click="toggleCurrentMusicFavorite"/);
  assert.match(app, /class="music-favorites-only-btn"[\s\S]*?>只播放收藏</);
  assert.match(musicPlayer, /const playableTracks = computed[\s\S]*?playbackSourceKind\.value === "favorites"[\s\S]*?options\.favoriteTracks\.value/);
  assert.match(server, /app\.put\("\/api\/music\/tracks\/:id\/favorite"[\s\S]*?prisma\.musicFavorite\.upsert/);
});

test("expanded player omits the changing listener marquee", () => {
  const playerStart = app.indexOf('<div v-if="musicPlayerExpanded" class="music-player-bar"');
  const playerEnd = app.indexOf("</header>", playerStart);
  const player = app.slice(playerStart, playerEnd);
  assert.doesNotMatch(player, /currentMusicListenerStatus|music-player-listener-marquee/);
  assert.doesNotMatch(player, /正在播放/);
  assert.match(player, /<small v-else-if="!musicPlaying">已暂停<\/small>/);
});

test("long music titles scroll in the left side of the single-row player", () => {
  assert.match(app, /class="music-title-track"[\s\S]*?'scrolling': musicTitleScrolling/);
  assert.match(app, /v-if="musicTitleScrolling" aria-hidden="true"/);
  assert.match(app, /class="music-player-tools"/);
  assert.match(css, /\.music-player-title \{[\s\S]*?grid-column: 1;[\s\S]*?text-align: left;/);
  assert.match(css, /\.music-title-track\.scrolling \{[\s\S]*?animation: musicTitleMarquee/);
});

test("manual music pause fades out within one second", () => {
  assert.match(musicPlayer, /const MUSIC_FADE_OUT_MS = 900;/);
  assert.match(musicPlayer, /function pause\(immediate = false\)[\s\S]*?musicFadeVolume[\s\S]*?targetAudio\.pause\(\)/);
  assert.match(musicPlayer, /async function play\(playOptions\?: \{ fadeIn\?: boolean \}\)[\s\S]*?clearFade\(\);[\s\S]*?targetAudio\.volume = playOptions\?\.fadeIn \? 0 : 1;/);
});

test("song control stays to the left of the font or score control", () => {
  const headerStart = app.indexOf('<header class="chat-head"');
  const headerEnd = app.indexOf("</header>", headerStart);
  const header = app.slice(headerStart, headerEnd);
  assert.ok(header.indexOf('class="bible-header-trigger"') < header.indexOf('class="music-player-control"'));
  assert.ok(header.indexOf('class="music-player-control"') < header.indexOf('class="message-font-control"'));
  assert.match(header, /v-if="musicScoreTriggerVisible"[\s\S]*?>谱<\/span>/);
  assert.match(header, /'page-turning': musicPlaying/);
  assert.match(css, /\.music-score-trigger\.page-turning \.[\w-]+ \{[\s\S]*?animation: musicScoreBreathe/);
  assert.match(css, /@keyframes musicScoreBreathe \{[\s\S]*?scale\(0\.92\)[\s\S]*?scale\(1\.12\)[\s\S]*?color:/);
  assert.match(css, /\.music-score-trigger \{[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;/);
  assert.doesNotMatch(css, /musicScorePageTurn/);
});

test("pinned content and live activity share one ordered notice stack", () => {
  const headerStart = app.indexOf('<header class="chat-head"');
  const headerEnd = app.indexOf("</header>", headerStart);
  const header = app.slice(headerStart, headerEnd);
  const afterHeader = app.slice(headerEnd);

  assert.match(header, /class="chat-title"[\s\S]*?class="chat-status-line"[\s\S]*?activeTopNotice\.title/);
  assert.doesNotMatch(afterHeader, /class="top-notice-shell"/);
  assert.match(afterHeader, /class="chat-notice-stack"[\s\S]*?class="pinned-ticker-row"[\s\S]*?pinnedText[\s\S]*?pinnedTickerBody[\s\S]*?class="chat-activity-ticker"[\s\S]*?<ActivityTicker :items="activityStatusItems"/);
  const noticeStart = afterHeader.indexOf('class="chat-notice-stack"');
  const noticeEnd = afterHeader.indexOf("</section>", noticeStart);
  const notice = afterHeader.slice(noticeStart, noticeEnd);
  const tickerStart = notice.indexOf('class="chat-activity-ticker"');
  const ticker = notice.slice(tickerStart);
  assert.match(notice, /@click="openPinnedFromTicker"/);
  assert.match(app, /function openPinnedFromTicker\(\)[\s\S]*?canPinCurrentChannel\.value[\s\S]*?openPinnedEditor\(\)[\s\S]*?pinnedExpanded\.value = true/);
  assert.doesNotMatch(notice, /pinned-image|block\.type === 'image'/);
  assert.doesNotMatch(ticker, /chat-activity-orbit/);
  assert.equal(ticker.match(/<ActivityTicker :items="activityStatusItems"/g)?.length, 1);
  assert.match(app, /activityTickerItems\([\s\S]*?bibleReaders\.value[\s\S]*?musicListeners\.value[\s\S]*?Object\.values\(store\.typing\)/);
  assert.match(app, /function handleActivitySocketConnect\(\)[\s\S]*?publishPresenceActivities\(\)[\s\S]*?setTimeout\([\s\S]*?publishPresenceActivities\(\)[\s\S]*?700/);
  assert.match(server, /socket\.on\("bible:reading"[\s\S]*?broadcastBibleReaders\(\)/);
  assert.match(server, /bibleReaderCleanupTimer[\s\S]*?45_000/);
  assert.match(css, /\.chat-notice-stack \{[\s\S]*?grid-row: 4;[\s\S]*?backdrop-filter: blur\(14px\) saturate\(135%\);/);
  const activityTickerRule = css.match(/\.chat-activity-ticker \{([^}]*)\}/)?.[1] ?? "";
  assert.doesNotMatch(activityTickerRule, /position: absolute;/);
  assert.match(css, /\.chat-activity-item \{[\s\S]*?background: linear-gradient/);
  assert.match(css, /\.chat-head \{[\s\S]*?height: calc\(56px \+ var\(--safe-top\)\);/);
  assert.match(css, /\.chat-status-text \{[\s\S]*?font-size: 11px;[\s\S]*?animation: chatStatusShimmer/);
  assert.match(header, /aria-label="请打开通知"[\s\S]*?notificationNudgeCharacters/);
  assert.match(css, /\.notification-nudge \{[\s\S]*?background: #facc15;[\s\S]*?animation: none;/);
  assert.match(app, /<em v-if="row\.message\.sender\.kind === 'virtual'">诶哎<\/em>/);
  assert.match(css, /\.sender-line em \{[\s\S]*?color: #38bdf8;[\s\S]*?text-shadow: none;/);
});

test("version changes add one clickable timeline-style update notice", () => {
  assert.match(app, /previousVersion !== APP_VERSION[\s\S]*?聊天室刚刚更新到版本 \$\{APP_VERSION\}/);
  assert.match(app, /row\.kind === 'version'[\s\S]*?class="time-separator version-update-separator"[\s\S]*?@click="openVersionUpdateNotice"/);
  assert.match(app, /openVersionUpdateNotice[\s\S]*?openSettings\("release"\)/);
  assert.match(css, /\.version-update-separator \{[\s\S]*?display: block;[\s\S]*?text-align: center;/);
});

test("chat images correct EXIF dimensions, cache privately, and preload offscreen rows", () => {
  assert.match(app, /function handleMessageImageLoad[\s\S]*?image\.naturalWidth[\s\S]*?resolvedMessageImageDimensions/);
  assert.match(app, /function preloadMessageImages[\s\S]*?messageImagePreloadQueue\.push/);
  assert.match(server, /function applyFileValidation[\s\S]*?Cache-Control", "private, no-cache"/);
});

test("Bible workspace promotes grouped favorites beside search", () => {
  assert.match(bibleWorkspace, /const homeSection = ref<"search" \| "favorites">\("search"\)/);
  assert.match(bibleWorkspace, /aria-label="书房功能"[\s\S]*?>经文检索<[\s\S]*?>经文收藏</);
  assert.match(bibleWorkspace, /groupBibleFavoritePassages\(props\.favorites\)/);
  assert.match(bibleWorkspace, /v-for="passage in favoritePassages"[\s\S]*?passage\.lookup\.normalizedReference/);
  assert.match(bibleWorkspace, /removeBibleFavoritePassage\(passage\)/);
  assert.doesNotMatch(bibleWorkspace, /favoritesCollapsed|team-chat-bible-favorites-collapsed/);
});

test("Bible workspace keeps its study title and offers a persistent font stepper", () => {
  assert.match(bibleWorkspace, /<strong>小故事的书房<\/strong>/);
  assert.match(bibleWorkspace, /<span>圣经<\/span><Sparkles[\s\S]*?新标点和合本（简体）/);
  assert.match(bibleWorkspace, /team-chat-bible-font-size/);
  assert.match(bibleWorkspace, /adjustBibleFontSize\(-1\)[\s\S]*?adjustBibleFontSize\(1\)/);
  assert.match(bibleWorkspace, /font-size: var\(--bible-font-size\)/);
});

test("music score view parts chat rows and reveals full-width pages with a translucent close control", () => {
  assert.match(app, /v-if="musicScoreStageVisible" class="music-score-stage"[\s\S]*?class="music-score-close"[\s\S]*?class="music-score-pages"/);
  assert.match(app, /score-exit-left[\s\S]*?score-exit-right/);
  assert.match(app, /'music-score-chat-cleared': musicScoreChatCleared/);
  assert.match(app, /musicScoreChatCleared\.value = true;[\s\S]*?setMusicScoreTimer\(MUSIC_SCORE_CHAT_DURATION_MS, \(\) => \{[\s\S]*?musicScoreStageVisible\.value = true;/);
  assert.match(app, /musicScoreStageClosing\.value = true;[\s\S]*?setMusicScoreTimer\(MUSIC_SCORE_STAGE_DURATION_MS, \(\) => \{[\s\S]*?musicScoreStageVisible\.value = false;[\s\S]*?musicScoreChatCleared\.value = false;/);
  assert.match(css, /\.music-score-stage \{[\s\S]*?animation: musicScoreStageIn 980ms cubic-bezier\(0\.22, 1, 0\.36, 1\)/);
  assert.match(css, /\.music-score-page img \{[\s\S]*?width: 100%;/);
  assert.match(css, /\.music-score-close \{[\s\S]*?background: rgba\(30, 30, 30, 0\.58\);[\s\S]*?backdrop-filter: blur/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.music-score-stage/);
  assert.match(app, /prepareMusicScoreExitSequence\(\);[\s\S]*?musicScoreChatCleared\.value = true;/);
  assert.match(css, /\.music-score-chat-cleared \.score-exit-left,[\s\S]*?transition-timing-function:[\s\S]*?cubic-bezier\(0\.55, 0, 1, 0\.45\)/);
});

test("PDF score pages render inline in the score view instead of a gray placeholder", () => {
  assert.match(app, /<PdfScoreInline v-if="isPdfScorePage\(page\)" :src="musicScorePageUrl\(page\)" \/>/);
  assert.doesNotMatch(app, /music-score-pdf-placeholder/);
  assert.doesNotMatch(css, /music-score-pdf-placeholder|\.music-score-page\.pdf/);
  assert.match(css, /\.pdf-score-inline-canvas \{[\s\S]*?width: 100%;[\s\S]*?display: block;/);
});

test("long pressing an empty part of the chat opens the available music score", () => {
  assert.match(app, /class="messages-scroll"[\s\S]*?@pointerdown\.passive="handleMessagesPointerDown"[\s\S]*?@pointermove\.passive="moveBlankScoreLongPress"/);
  assert.match(app, /function beginBlankScoreLongPress\(event: PointerEvent\)[\s\S]*?!musicScoreTriggerVisible\.value \|\| musicScoreOpen\.value[\s\S]*?openMusicScore\(\);/);
  assert.match(app, /target\.closest\("\.bubble,[\s\S]*?button,[\s\S]*?audio,[\s\S]*?video/);
  assert.match(app, /function moveBlankScoreLongPress\(event: PointerEvent\)[\s\S]*?distance > 10[\s\S]*?clearBlankScoreLongPress\(\)/);
});

test("score image preview fills the viewport width without black side bars", () => {
  assert.match(app, /'score-preview-modal': previewPinnedImage\?\.score/);
  assert.match(css, /\.media-preview-shell\.image\.score \{[\s\S]*?background: #fff;/);
  assert.match(css, /\.media-preview-shell\.score \.media-preview-image \{[\s\S]*?width: 100vw;[\s\S]*?max-width: none;/);
});

test("double-at song mentions render inline with independent playback controls", () => {
  assert.match(app, /musicMentionTokenAtCursor\(input\.value, composerCaret\.value\)/);
  assert.match(app, /activeComposerSuggestionKind === 'music'[\s\S]*?chooseMusicMentionSuggestion\(track\)/);
  assert.match(app, /const mention = `@@\$\{track\.title\} `/);
  assert.match(app, /class="message-text music-mention-text"[\s\S]*?class="music-mention-capsule"/);
  assert.match(app, /toggleMentionedMusic\(row\.message\)[\s\S]*?stopMentionedMusic\(row\.message\)/);
  assert.match(app, /function stopMentionedMusic[\s\S]*?stopMusic\(\)/);
  assert.match(musicPlayer, /function stop\(\)[\s\S]*?audio\.currentTime = 0/);
  assert.match(app, /v-if="!isMentionedMusicPlaying\(row\.message\)"[\s\S]*?music-mention-capsule-play[\s\S]*?<template v-else>[\s\S]*?music-mention-capsule-stop[\s\S]*?music-mention-capsule-pause/);
  assert.match(css, /\.music-mention-text \.music-mention-title \{[\s\S]*?color: #ed741b;[\s\S]*?font-weight: 850;/);
  assert.match(css, /\.music-mention-capsule \{[\s\S]*?border-radius: 999px;[\s\S]*?radial-gradient[\s\S]*?box-shadow:/);
});

test("audio messages offer multi-group forwarding from the long-press menu", () => {
  assert.match(app, /isAudioMessage\(pendingMessageActions\)[^>]*[\s\S]*?openForwardMessageDialog[\s\S]*?转发到其他群/);
  assert.match(app, /class="small-modal forward-message-modal"[^>]*submitAudioForward/);
  assert.match(app, /v-for="channel in forwardTargetChannels"/);
  assert.match(app, /\/api\/messages\/\$\{message\.id\}\/forward/);
  assert.match(css, /\.forward-channel-row\.selected \{/);
});

test("forwarded audio copies attached score pages and exposes them on the new message", () => {
  assert.match(server, /include: \{ musicScores: \{ orderBy: \{ id: "asc" \}, include: \{ pages: \{ orderBy: \{ pageIndex: "asc" \} \} \} \}, musicLyrics: true \}/);
  assert.match(server, /scores: source\.musicScores\.map[\s\S]*?fs\.promises\.copyFile\(page\.sourcePath, path\.join\(MUSIC_SCORE_DIR, page\.filePath\)\)/);
  assert.match(server, /musicScores: \{[\s\S]*?create: copy\.scores\.map/);
  assert.match(app, /return message\.scores\?\.\[0\]\?\.pages\[0\][\s\S]*?musicTracks\.value\.find/);
  assert.match(app, /const previewScoreTrack = computed[\s\S]*?store\.messages\.find\(\(message\) => message\.id === trackId\)/);
});

test("music scores preload through authenticated blobs for reliable Safari rendering", () => {
  assert.match(app, /async function preloadMusicScorePages/);
  assert.match(app, /fetch\(musicScoreRequestUrl\(page\), \{ headers: authHeaders\(\) \}\)/);
  assert.match(app, /\/api\/music\/scores\/\$\{page\.scoreId\}\/pages\/\$\{page\.id\}/);
  assert.match(app, /URL\.createObjectURL\(blob\)/);
  assert.match(app, /void preloadMusicScorePages\(result\.tracks\)/);
  assert.match(app, /musicScoreCachedUrls\.value\[page\.id\]/);
  assert.match(server, /canReadMusicScore\(score\.track\.channel\.kind, canAccessSourceChannel\)/);
});

test("SRT and LRC lyrics upload from the music manager and render over the header during playback", () => {
  assert.match(musicManager, /ref="trackLyricsInput" type="file" accept="\.lrc,\.srt"/);
  assert.match(musicManager, /xhrUpload\("PUT", `\/api\/music\/tracks\/\$\{track\.id\}\/lyrics`, form\)/);
  assert.match(lyricsHeader, /class="music-lyrics-header"[\s\S]*?music-lyrics-current-fill/);
  assert.match(app, /scheduleMusicLyricsHeaderResume[\s\S]*?5000/);
  assert.match(app, /compactBytes\(row\.message\.fileSize\)[\s\S]*?带歌词/);
  assert.match(server, /app\.put\("\/api\/music\/tracks\/:id\/lyrics"/);
  assert.match(server, /source\.musicLyrics[\s\S]*?musicLyrics: \{\s*create: \{\s*fileName: source\.musicLyrics\.fileName/);
});

test("Enhanced LRC uses segment timing for progressive karaoke color", () => {
  assert.match(app, /import MusicLyricsHeader from "\.\/components\/MusicLyricsHeader\.vue"/);
  assert.match(app, /<MusicLyricsHeader[\s\S]*?:get-current-time-ms="currentMusicPlaybackTimeMs"/);
  assert.doesNotMatch(app, /musicLyricsFrame|requestAnimationFrame\(tick\)|musicCurrentTimeMs/);
  assert.match(lyricsHeader, /window\.setTimeout\(runClock, MUSIC_LYRICS_TICK_MS\)/);
  assert.match(css, /\.music-lyrics-segment-fill \{[\s\S]*?transition: clip-path 70ms linear;/);
  assert.match(server, /parseLyrics\(content, file\.filename\)/);
});

test("message effects pause outside the chat viewport and when the document is hidden", () => {
  assert.match(app, /new IntersectionObserver\(handleMessageEffectIntersections/);
  assert.match(app, /root: scroller\.value/);
  assert.match(app, /:data-message-effect="messageEffect\(row\.message\) \|\| null"/);
  assert.match(app, /const observationTarget = bubble\.closest<HTMLElement>\("\.message-row\[data-message-id\]"\)/);
  assert.match(app, /messageEffectObserver\.observe\(observationTarget\)/);
  assert.doesNotMatch(app, /messageEffectObserver\.observe\(bubble\)/);
  assert.match(app, /rootMargin: "0px"/);
  assert.doesNotMatch(app, /preloadMargin/);
  assert.match(app, /shouldRenderMessageEffect\(/);
  assert.match(app, /document\.addEventListener\("visibilitychange", handleDocumentVisibilityChange\)/);
  assert.match(app, /syncFlashEffectTimer\(\)/);
});

test("large message timelines render a measured virtual window", () => {
  assert.match(app, /const renderedTimelineRows = computed/);
  assert.match(app, /new ResizeObserver\(handleTimelineResize\)/);
  assert.match(app, /class="message-virtual-spacer message-virtual-spacer-top"/);
  assert.match(app, /v-for="\{ row, timelineIndex, key: timelineKey \} in renderedTimelineRows"/);
  assert.match(app, /class="message-virtual-spacer message-virtual-spacer-bottom"/);
  assert.doesNotMatch(app, /v-for="\(row, timelineIndex\) in timeline"/);
  assert.match(app, /overscanBefore: Math\.max\(VIRTUAL_TIMELINE_MIN_BACKWARD_OVERSCAN, timelineViewportHeight\.value \* VIRTUAL_TIMELINE_BACKWARD_VIEWPORTS\)/);
  assert.match(app, /overscanAfter: VIRTUAL_TIMELINE_FORWARD_OVERSCAN/);
});

test("image messages reserve their intrinsic aspect ratio before loading", () => {
  assert.match(app, /:width="messageImageDimensions\(row\.message\)\?\.width"/);
  assert.match(app, /:height="messageImageDimensions\(row\.message\)\?\.height"/);
  assert.match(app, /estimatedImageTimelineRowHeight\(row\.message, timelineViewportWidth\.value\)/);
});

test("media and link preview bubbles use compact aligned frames", () => {
  assert.match(app, /'link-preview-bubble': !!linkPreviewFor\(row\.message\)/);
  assert.match(css, /\.bubble\.media-bubble \{[\s\S]*?padding: 3px;/);
  assert.match(css, /\.media-bubble \.chat-image,[\s\S]*?\.media-bubble \.image-preview-button \{[\s\S]*?border-radius: 0;/);
  assert.match(css, /\.bubble\.link-preview-bubble \{[\s\S]*?width: 428px;[\s\S]*?max-width: 100%;[\s\S]*?padding: 4px;/);
  assert.match(css, /\.link-preview-bubble \.message-text \{[\s\S]*?overflow-wrap: anywhere;/);
});

test("URL-only messages collapse after two lines and expand before navigating", () => {
  assert.match(app, /anchors\[0\]\.classList\.add\("collapsible-message-url"\)/);
  assert.match(app, /function expandLongMessageUrl[\s\S]*?scrollHeight > link\.clientHeight[\s\S]*?event\.preventDefault\(\)[\s\S]*?classList\.add\("expanded"\)/);
  assert.match(app, /handleBubbleClick[\s\S]*?expandLongMessageUrl\(event\)/);
  assert.match(css, /\.collapsible-message-url:not\(\.expanded\) \{[\s\S]*?-webkit-line-clamp: 2;/);
});

test("music uploads accept multiple files and report hash-based reuse", () => {
  assert.match(musicManager, /ref="songInput" type="file" accept="\.mp3,\.m4a" multiple hidden @change="handleSongPicked"/);
  assert.match(musicManager, /result\.skipped/);
  assert.match(app, /result\.duplicate/);
  assert.match(app, /result\.skipped/);
});

test("karaoke clock sleeps across iOS page hiding and component exit", () => {
  assert.match(lyricsHeader, /window\.addEventListener\("pagehide", handlePageHide\)/);
  assert.match(lyricsHeader, /window\.addEventListener\("pageshow", handlePageShow\)/);
  assert.match(lyricsHeader, /onBeforeUnmount\([\s\S]*?clearClock\(\)/);
  assert.match(app, /if \(!documentVisible\.value\) \{\s*clearMusicLyricsHeaderResumeTimer\(\)/);
});

test("karaoke lyrics stay above chat content and retain refined enter and leave motion", () => {
  assert.match(app, /<\/header>[\s\S]*?<Transition name="music-lyrics-panel">[\s\S]*?<MusicLyricsHeader/);
  assert.doesNotMatch(lyricsHeader, /music-lyrics-track-title/);
  assert.match(css, /\.music-lyrics-header \{[\s\S]*?height: calc\(112px \+ var\(--safe-top\)\);[\s\S]*?border-radius: 0;/);
  assert.match(css, /\.chat-pane > \.music-lyrics-header \{[\s\S]*?z-index: 30;/);
  assert.doesNotMatch(css, /\.chat-pane > :not\(\.parallax-background\):not\(\.modal-shell\) \{[\s\S]*?z-index: 1;/);
  assert.doesNotMatch(css, /round 0 0 26px 26px/);
  assert.match(css, /\.music-lyrics-panel-enter-active[\s\S]*?musicLyricsReveal/);
  assert.match(css, /\.music-lyrics-panel-leave-active[\s\S]*?musicLyricsRetract/);
});

test("fresh browser and login entry force the chat to the newest semantic position", () => {
  assert.match(app, /onMounted\([\s\S]*?await enterChatAtNewest\(\)/);
  assert.match(app, /async function doLogin\([\s\S]*?await enterChatAtNewest\(\)/);
});

test("music manager supports search, four sort modes, and manual movement controls", () => {
  assert.match(musicManager, /v-model="query" type="search"/);
  for (const value of ["manual", "heat", "uploaded", "filename"]) assert.match(musicManager, new RegExp(`value: "${value}"`));
  assert.match(musicManager, /movePlaylistTrack\(activePlaylist, track\.id, -1\)[\s\S]*?movePlaylistTrack\(activePlaylist, track\.id, 1\)/);
  assert.match(css, /\.music-manager-toolbar \{[\s\S]*?display: flex;/);
});

test("music manager offers library navigation, playlists, multi-select, and compact shared cards", () => {
  assert.match(musicManager, />全部诗歌</);
  assert.match(musicManager, />我的收藏</);
  assert.match(musicManager, />我的歌单</);
  assert.match(musicManager, /aria-label="新建歌单" @click="createPlaylist"/);
  assert.match(musicManager, /toggleSelectionMode[\s\S]*?toggleTrackSelected/);
  assert.match(musicManager, /addSelectedToPlaylist[\s\S]*?deleteSelectedTracks/);
  assert.match(musicManager, /@click="openPlaylistPicker\(activePlaylist\)"/);
  assert.match(musicManager, /v-if="shareTarget"[\s\S]*?分享到[\s\S]*?v-model\.number="shareChannelId"/);
  assert.match(musicManager, /v-model="shareDescription"/);
  assert.match(musicManager, /sharePlaylist[\s\S]*?\/share[\s\S]*?description: shareDescription\.value[\s\S]*?shareStatus/);
  assert.match(app, /function sharedMusicPlaylistDescription[\s\S]*?messagePayloadRecord/);
  assert.match(app, /class="music-playlist-message-text"[\s\S]*?class="music-playlist-message-card"/);
  assert.doesNotMatch(app, /music-playlist-message-card[\s\S]{0,500}music-playlist-message-description/);
  assert.doesNotMatch(app, /music-playlist-message-card[\s\S]{0,500}ownerName \}\} 分享的歌单/);
  assert.match(app, /openSharedMusicPlaylistFromTap\(row\.message\)/);
  assert.match(app, /openSharedMusicPlaylistFromTap[\s\S]*?suppressNextTapUntil/);
  assert.match(app, /openMusicManager\(\{ kind: "playlist", id: playlist\.id \}\)/);
  assert.match(app, /music-playlist-message-card[\s\S]*?@pointerdown\.stop="beginMessageLongPress\(row\.message, \$event\)"/);
  assert.match(server, /app\.post\("\/api\/music\/playlists\/:id\/share"[\s\S]*?description: z\.string\(\)\.trim\(\)\.max\(500\)[\s\S]*?payload:[\s\S]*?description: body\.description/);
  assert.match(css, /\.music-playlist-bubble \{[\s\S]*?width: fit-content;/);
  assert.match(css, /\.music-playlist-cluster \{[\s\S]*?width: fit-content;/);
  assert.match(css, /\.music-playlist-message-card \{[\s\S]*?width: min\(320px,/);
});

test("the photo picker uploads every selected image", () => {
  assert.match(app, /ref="photoInput"[^>]*accept="image\/\*"[^>]*multiple[^>]*@change="handlePickedFiles"/);
  assert.match(app, /async function handlePickedFiles[\s\S]*?Array\.from\(input\.files \|\| \[\]\)[\s\S]*?for \(const file of files\)/);
});

test("music actions use the server-authorized track ownership flag", () => {
  assert.match(app, /function isManageableMusicMessage[\s\S]*?musicTracks\.value\.some\(\(track\) => track\.id === message\.id && track\.canManage\)/);
  assert.match(app, /function openMusicTrackInManager[\s\S]*?openMusicManager\(\{ kind: "track", id: message\.id \}\)/);
  assert.match(musicManager, /v-if="track\.canManage"/);
});

test("mobile settings categories run horizontally across the top", () => {
  assert.match(css, /@media \(max-width: 700px\) \{[\s\S]*?\.settings-modal \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\);/);
  assert.match(css, /@media \(max-width: 700px\) \{[\s\S]*?\.settings-nav \{[\s\S]*?display: flex;[\s\S]*?overflow-x: auto;/);
});

test("pinned editor is a compact single-column dialog without a visible title bar", () => {
  assert.match(app, /aria-label="编辑置顶消息"[\s\S]*?class="small-modal pinned-editor-modal"/);
  assert.doesNotMatch(app, /<strong>编辑置顶消息<\/strong>/);
  assert.match(css, /\.pinned-editor-modal \{[\s\S]*?grid-template-rows: minmax\(0, 1fr\);/);
});

test("browsing a playlist leaves the active audio alone while clicking a track switches and plays it", () => {
  const sourceSelection = app.match(/function selectMusicSource\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(sourceSelection, /setMusicAudioTrack|currentMusicTrackId\.value\s*=/);
  assert.match(musicPlayer, /const currentTrack = computed\(\(\) =>[\s\S]*?options\.tracks\.value\.find/);
  assert.match(app, /function selectMusicTrack[\s\S]*?selectMusicTrackCore\(track\)/);
  assert.match(musicPlayer, /function selectTrack[\s\S]*?pushMusicPlaybackHistory[\s\S]*?setAudioTrack\(track\)[\s\S]*?void play\(\)/);
  assert.match(musicPlayer, /function shiftTrack[\s\S]*?takePreviousMusicTrack/);
});

test("music restores account state and defaults new listeners to shuffle", () => {
  assert.match(musicPlayer, /const playbackMode = ref<MusicPlaybackMode>\("shuffle"\)/);
  assert.match(musicPlayer, /activateAccount[\s\S]*?Date\.parse\(local\.updatedAt\)[\s\S]*?Date\.parse\(server\.updatedAt\)/);
  assert.match(musicPlayer, /pendingRestoredProgressMs[\s\S]*?handleMetadataLoaded[\s\S]*?audio\.currentTime/);
  assert.match(musicPlayer, /runtime\.setInterval\(\(\) => \{\s*if \(playing\.value\) persistPlaybackState\(true\);\s*\}, MUSIC_STATE_SYNC_INTERVAL_MS\)/);
  assert.match(musicPlayer, /function handleSeeked\(\)[\s\S]*?persistPlaybackState\(true\)/);
  assert.match(musicPlayer, /addEventListener\("seeked", handleSeeked\)/);
});

test("music manager overlay is composited above message water effects", () => {
  assert.match(app, /<MusicManager\s+v-if="musicManagerOpen"/);
  assert.match(css, /\.music-manager-shell \{[\s\S]*?position: fixed;[\s\S]*?z-index: 3[0-9];/);
});

test("wallpaper labels adapt sender names without changing system notices", () => {
  assert.match(app, /"--wallpaper-label-text": wallpaperLabelText\.value/);
  assert.match(app, /syncWallpaperLabelToneFromImage/);
  assert.match(css, /\.sender-line \{[\s\S]*?color: var\(--wallpaper-label-text\);[\s\S]*?text-shadow: var\(--wallpaper-label-shadow\);/);
  const systemBubbleRule = css.match(/\.message-row\.system \.bubble,\s*\.message-row\.mine\.system \.bubble \{([^}]*)\}/)?.[1] ?? "";
  assert.match(systemBubbleRule, /color: var\(--muted\);/);
  assert.doesNotMatch(systemBubbleRule, /text-shadow|font-weight/);
});

test("reaction details use distinct polished icon treatments", () => {
  assert.match(css, /\.reaction-detail \{[\s\S]*?font-size: 12px;/);
  assert.match(css, /\.reaction-like svg \{[\s\S]*?linear-gradient/);
  assert.match(css, /\.reaction-favorite svg \{[\s\S]*?linear-gradient/);
});

test("composer autosizes through twelve rows while controls keep their dimensions", () => {
  assert.match(app, /function syncComposerHeight/);
  assert.match(app, /watch\(input,[\s\S]*?syncComposerHeight/);
  assert.match(css, /\.composer textarea \{[\s\S]*?max-height: 280px;/);
  assert.match(css, /\.composer-main \{[\s\S]*?align-items: flex-end;/);
});

test("the profile settings entry opens complete self-service account controls", () => {
  assert.match(app, /async function openSettings\(tab: SettingsTab = "account"\)/);
  assert.match(app, /settingsTab === 'account'[\s\S]*?>账号<[\s\S]*?class="account-avatar-card"/);
  assert.match(app, /uploadOwnAvatar[\s\S]*?\/api\/me\/avatar/);
  assert.match(app, /saveOwnProfile[\s\S]*?\/api\/me\/profile/);
  assert.match(app, /changeOwnPassword[\s\S]*?\/api\/auth\/change-password/);
  assert.match(app, /deleteOwnAccount[\s\S]*?\/api\/me\/account/);
  assert.match(server, /app\.patch\("\/api\/me\/profile", \{ preHandler: requireAuth \}/);
  assert.match(server, /app\.post\("\/api\/me\/avatar", \{ preHandler: requireAuth \}/);
  assert.match(server, /app\.delete\("\/api\/me\/account", \{ preHandler: requireAuth \}/);
  assert.match(server, /至少需要保留一个管理员/);
  assert.match(server, /accountId: null,[\s\S]*?displayName: "已注销用户"[\s\S]*?await tx\.account\.delete/);
});

test("composer swaps one compact trailing action between more and a connection-aware send", () => {
  assert.match(app, /v-if="canSendText"[\s\S]*?class="send-btn composer-edge-btn composer-send-btn"[\s\S]*?:disabled="!canSubmitText"/);
  assert.match(app, /<button v-else class="icon-btn composer-edge-btn"[\s\S]*?aria-label="更多功能"/);
  assert.match(app, /class="composer-send-status"[\s\S]*?:data-send-state="composerSendState"[\s\S]*?aria-live="polite"/);
  assert.match(app, /const canSubmitText = computed\(\(\) => canSendText\.value && socketReadyToSend\.value && !messageSendPending\.value\)/);
  assert.match(css, /\.composer-main \{[\s\S]*?gap: 2px;/);
  assert.match(css, /\.composer-main \.composer-edge-btn \{[\s\S]*?width: 34px;[\s\S]*?flex: 0 0 34px;[\s\S]*?padding: 0;/);
  assert.match(css, /\.composer-main \.composer-send-btn:disabled \{[\s\S]*?cursor: not-allowed;[\s\S]*?opacity: 0\.48;/);
});

test("original image selection is a small unchecked control on the photo tile", () => {
  assert.match(app, /const keepOriginalImages = ref\(false\)/);
  assert.match(app, /class="tool-tile-wrap photo-tool-wrap"[\s\S]*?class="original-image-corner"[\s\S]*?>原图</);
  assert.doesNotMatch(app, /class="original-image-toggle"/);
  assert.match(css, /\.original-image-corner \{[\s\S]*?position: absolute;[\s\S]*?bottom: -1px;/);
  assert.match(css, /\.original-image-check \{[\s\S]*?width: 14px;[\s\S]*?border-radius: 50%;/);
});

test("the admin-only log workspace combines sessions, music progress, and usage activity", () => {
  assert.match(server, /app\.get\("\/api\/admin\/activity-logs", \{ preHandler: requireAdmin \}, adminActivityLogs\)/);
  assert.match(server, /CREATE TABLE IF NOT EXISTS account_activity_logs/);
  assert.match(server, /kind: "channel_view"/);
  assert.match(server, /kind: "message_sent"/);
  assert.match(app, /isLogRoute && store\.account\?\.isAdmin/);
  assert.doesNotMatch(app, /@click="openAdminPage\('loginLogs'\)"/);
  assert.match(app, /activityLogFilterOptions[\s\S]*?"session"[\s\S]*?"music"[\s\S]*?"usage"/);
  assert.match(musicPlayer, /\/api\/music\/tracks\/\$\{session\.trackId\}\/progress/);
  assert.match(app, /本次在线 \{\{ activityDuration\(log\.durationMs\) \}\}/);
  assert.match(app, /当时服务器 v\{\{ log\.latestVersion \}\}/);
});

test("score pages can be managed individually and paged in preview", () => {
  assert.match(musicManager, /moveScorePage\(score, pageIndex, -1\)[\s\S]*?moveScorePage\(score, pageIndex, 1\)/);
  assert.match(musicManager, /removeScorePage\(score, page\)/);
  assert.match(app, /class="score-preview-pager"[\s\S]*?上一页歌谱[\s\S]*?下一页歌谱/);
  assert.match(css, /\.score-preview-pager \{[\s\S]*?bottom: calc\(var\(--safe-bottom\) \+ 12px\);/);
  assert.match(css, /\.score-preview-pager button \{[\s\S]*?background: rgba\(20, 20, 20, 0\.24\);/);
});
