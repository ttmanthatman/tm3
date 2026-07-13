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

test("pinned notices stay above chat content and retain their modal layer", () => {
  assert.match(css, /\.chat-pane > :not\(\.parallax-background\):not\(\.modal-shell\) \{[\s\S]*?z-index: 1;/);
  assert.match(css, /\.pinned-view-shell \{[\s\S]*?z-index: 50;/);
  assert.match(app, /class="modal-shell pinned-view-shell"[\s\S]*?class="primary-btn pinned-ack-btn"/);
});

test("new-message jump is a compact translucent arrow centered above the composer", () => {
  assert.match(app, /class="new-message-jump"[\s\S]*?aria-label="跳到最新消息"[\s\S]*?<ArrowDown/);
  assert.doesNotMatch(app, /<ArrowDown :size="16" \/>\{\{ hasUnreadMessages/);
  assert.match(css, /\.new-message-jump \{[\s\S]*?left: 50%;[\s\S]*?bottom: calc\(58px \+ var\(--keyboard-offset\)\);[\s\S]*?width: 34px;[\s\S]*?height: 34px;[\s\S]*?background: rgba\(/);
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

test("like alerts use the top notice rail instead of a reading-area overlay", () => {
  assert.match(app, /likeNotificationToTopNotice\(/);
  assert.match(app, /activeTopNotice\.kind === 'like'[\s\S]*?关闭点赞提醒/);
  assert.doesNotMatch(app, /class="like-notification-stack"/);
});

test("shine scans one vertical highlight fully across message text before restarting", () => {
  assert.match(css, /\.message-effect-shine \.message-text \{[\s\S]*?linear-gradient\(90deg,[\s\S]*?#6a6a6a 45%,[\s\S]*?#ffffff 50%,[\s\S]*?#6a6a6a 55%,[\s\S]*?background-size: 300% 100%;[\s\S]*?background-repeat: no-repeat;[\s\S]*?animation: messageShine 3\.6s linear infinite;/);
  assert.match(css, /@keyframes messageShine \{[\s\S]*?0% \{[\s\S]*?background-position: 100% 0;[\s\S]*?100% \{[\s\S]*?background-position: 0 0;/);
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
  assert.match(app, /v-else-if="!showFavorites" class="composer"/);
  assert.match(app, /v-if="!showFavorites && isMusicChannel" class="composer music-channel-composer"/);
  assert.match(css, /\.favorites-main-list \{[\s\S]*?width: min\(620px, 100%\);/);
  assert.match(css, /\.favorite-image-card \{[\s\S]*?width: fit-content;[\s\S]*?justify-self: start;/);
  assert.match(css, /\.favorite-image-card \.favorite-message-content \{[\s\S]*?background: transparent;/);
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
  assert.match(css, /\.music-player-transport \{[\s\S]*?left: var\(--music-player-anchor-x\);[\s\S]*?translateX\(-50%\)/);
});

test("manual music pause fades out within one second", () => {
  assert.match(app, /const MUSIC_FADE_OUT_MS = 900;/);
  assert.match(app, /function pauseMusic\(immediate = false\)[\s\S]*?musicFadeVolume[\s\S]*?audio\.pause\(\)/);
  assert.match(app, /function playCurrentMusic\(\)[\s\S]*?cancelMusicFade\(\);[\s\S]*?musicAudio\.volume = 1;/);
});

test("song control stays to the left of the font or score control", () => {
  const headerStart = app.indexOf('<header class="chat-head"');
  const headerEnd = app.indexOf("</header>", headerStart);
  const header = app.slice(headerStart, headerEnd);
  assert.ok(header.indexOf('class="music-player-control"') < header.indexOf('class="message-font-control"'));
  assert.match(header, /v-if="musicScoreTriggerVisible"[\s\S]*?>谱<\/span>/);
  assert.match(header, /'page-turning': musicPlaying/);
  assert.match(css, /\.music-score-trigger\.page-turning \.[\w-]+ \{[\s\S]*?animation: musicScoreBreathe/);
  assert.match(css, /@keyframes musicScoreBreathe \{[\s\S]*?scale\(0\.92\)[\s\S]*?scale\(1\.12\)[\s\S]*?color:/);
  assert.match(css, /\.music-score-trigger \{[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;/);
  assert.doesNotMatch(css, /musicScorePageTurn/);
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
