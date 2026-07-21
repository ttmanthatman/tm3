import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("./App.vue", import.meta.url), "utf8");
const manager = fs.readFileSync(new URL("./features/music/MusicManager.vue", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("./styles.css", import.meta.url), "utf8");

test("playlist sharing always opens an explicit channel destination dialog", () => {
  assert.match(manager, /aria-label="分享歌单" @click="openShare\(playlist\)"/);
  assert.match(manager, /v-if="shareTarget"[\s\S]*?分享到[\s\S]*?aria-label="选择接收歌单的频道"/);
  assert.match(manager, /function openShare\(playlist: MusicPlaylistDTO\)[\s\S]*?shareTargetId\.value = playlist\.id/);
  assert.match(manager, /async function sharePlaylist\(\)[\s\S]*?\/api\/music\/playlists\/\$\{playlist\.id\}\/share[\s\S]*?description: shareDescription\.value/);
  assert.match(styles, /\.music-manager-share-body\s*\{[\s\S]*?display: grid/);
});

test("playlist rename is inline in the manager and persists through the rename endpoint", () => {
  assert.match(manager, /function beginPlaylistRename\(playlist: MusicPlaylistDTO\)[\s\S]*?playlistRenameDraft\.value = playlist\.name/);
  assert.match(manager, /class="music-manager-rename-input"[\s\S]*?@keydown\.enter="savePlaylistRename\(activePlaylist\)"/);
  assert.match(manager, /async function savePlaylistRename[\s\S]*?method: "PATCH", body: JSON\.stringify\(\{ name \}\)/);
});

test("selected tracks can be added to an owned playlist in one operation", () => {
  assert.match(manager, /v-if="selectionMode" class="music-manager-bulk-bar"[\s\S]*?addSelectedToPlaylist/);
  assert.match(manager, /async function addSelectedToPlaylist\(\)[\s\S]*?method: "PUT",[\s\S]*?mergeTrackIds\(existingIds, addedIds\)/);
  assert.match(manager, /const selectedManageableIds = computed|selectedManageableIds/);
  assert.match(app, /@refresh-playlists="loadMusicPlaylists"/);
});
