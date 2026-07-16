import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const server = fs.readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const schema = fs.readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");

test("personal playlists keep ordered music references and account playback state", () => {
  assert.match(schema, /model MusicPlaylist \{[\s\S]*?accountId[\s\S]*?tracks\s+MusicPlaylistTrack\[\]/);
  assert.match(schema, /model MusicPlaylistTrack \{[\s\S]*?@@unique\(\[playlistId, trackId\]\)[\s\S]*?@@unique\(\[playlistId, position\]\)/);
  assert.match(schema, /model MusicPlaybackState \{[\s\S]*?sourceKind[\s\S]*?progressMs[\s\S]*?playbackMode/);
});

test("playlist routes enforce ownership, valid music tracks, and chat-only sharing", () => {
  assert.match(server, /app\.post\("\/api\/music\/playlists"[\s\S]*?\$\{account\.displayName\}的歌单[\s\S]*?while \(names\.has\(name\)\)/);
  assert.match(server, /app\.put\("\/api\/music\/playlists\/:id\/tracks"[\s\S]*?playlist\.accountId !== auth\.accountId[\s\S]*?channel: \{ kind: "music" \}/);
  assert.match(server, /app\.post\("\/api\/music\/playlists\/:id\/share"[\s\S]*?channel\.kind !== "standard" && channel\.kind !== "direct"/);
  assert.match(server, /type: "music_playlist"[\s\S]*?musicPlaylistShare\.create/);
});

test("playback state validates shared playlist access and rejects stale writers", () => {
  assert.match(server, /app\.put\("\/api\/music\/playback-state"[\s\S]*?knownUpdatedAt[\s\S]*?accepted: false/);
  assert.match(server, /body\.sourceKind === "playlist"[\s\S]*?canAccessMusicPlaylist/);
  assert.match(server, /body\.sourceKind === "favorites"[\s\S]*?musicFavorite\.findUnique/);
  assert.match(server, /app\.delete\("\/api\/music\/playlists\/:id"[\s\S]*?musicPlaybackState\.updateMany[\s\S]*?sourceKind: "library"/);
});

test("media and Bible responses expose conditional validators", () => {
  assert.match(server, /function applyFileValidation[\s\S]*?ETag[\s\S]*?Last-Modified[\s\S]*?private, no-cache/);
  assert.match(server, /api\/bible\/chapter[\s\S]*?applyJsonValidation/);
  assert.match(server, /api\/music\/tracks\/:id\/stream[\s\S]*?applyFileValidation/);
  assert.match(server, /app\.get\("\/avatars\/:file"[\s\S]*?applyFileValidation/);
  assert.match(server, /app\.get<\{ Params: \{ kit: string; file: string \} \}>\("\/api\/parallax\/:kit\/:file"[\s\S]*?applyFileValidation/);
});
