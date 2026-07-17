import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("./App.vue", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("./styles.css", import.meta.url), "utf8");

test("playlist sharing always opens an explicit channel destination dialog", () => {
  assert.match(app, /class="music-library-card-share"[\s\S]*?aria-label="`分享歌单 \$\{playlist\.name\}`"[\s\S]*?@click\.stop="openMusicPlaylistShare\(playlist\)"/);
  assert.match(app, /v-if="musicPlaylistShareTarget"[\s\S]*?<label for="music-playlist-share-channel">分享到<\/label>[\s\S]*?aria-label="选择接收歌单的频道"/);
  assert.match(app, /async function shareMusicPlaylistAction\(\)[\s\S]*?closeMusicPlaylistActions\(\);[\s\S]*?await nextTick\(\);[\s\S]*?openMusicPlaylistShare\(playlist\)/);
  assert.match(styles, /\.music-library-card-share\s*\{[\s\S]*?border-radius: 50%/);
});

test("playlist rename waits for the action dialog to close and focuses its input", () => {
  assert.match(app, /async function beginMusicPlaylistRename\(\)[\s\S]*?closeMusicPlaylistActions\(\);[\s\S]*?await nextTick\(\);[\s\S]*?musicPlaylistRenameTarget\.value = playlist[\s\S]*?musicPlaylistRenameInput\.value\?\.focus\(\)/);
  assert.match(app, /id="music-playlist-rename-input" ref="musicPlaylistRenameInput"/);
});

test("selected music messages can be added to an owned playlist in one operation", () => {
  assert.match(app, /const selectedMessageMusicTracks = computed\(\(\) => musicTracks\.value\.filter\(\(track\) => selectedMessageIds\.value\.has\(track\.id\)\)\)/);
  assert.match(app, /v-if="isMusicChannel"[\s\S]*?@click="openSelectedMessagesPlaylist"[\s\S]*?添加到歌单/);
  assert.match(app, /async function addSelectedMessagesToPlaylist\(\)[\s\S]*?await saveMusicPlaylistTracks\(playlist,[\s\S]*?\.\.\.addedIds/);
  assert.match(app, /aria-label="把所选音频添加到歌单"[\s\S]*?目标歌单[\s\S]*?selectedMessagesPlaylistStatus/);
});
