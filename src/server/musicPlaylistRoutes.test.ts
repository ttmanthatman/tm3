import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const server = fs.readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const musicRoutes = fs.readFileSync(new URL("./routes/music.ts", import.meta.url), "utf8");
const musicService = fs.readFileSync(new URL("./services/musicService.ts", import.meta.url), "utf8");
const schema = fs.readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");

test("personal playlists keep ordered music references and account playback state", () => {
  assert.match(schema, /model MusicPlaylist \{[\s\S]*?accountId[\s\S]*?tracks\s+MusicPlaylistTrack\[\]/);
  assert.match(schema, /model MusicPlaylistTrack \{[\s\S]*?@@unique\(\[playlistId, trackId\]\)[\s\S]*?@@unique\(\[playlistId, position\]\)/);
  assert.match(schema, /model MusicPlaybackState \{[\s\S]*?sourceKind[\s\S]*?progressMs[\s\S]*?playbackMode/);
});

test("playlist routes enforce ownership, valid music tracks, and chat-only sharing", () => {
  assert.match(musicRoutes, /app\.post\("\/api\/music\/playlists"[\s\S]*?\$\{account\.displayName\}的歌单[\s\S]*?while \(names\.has\(name\)\)/);
  assert.match(musicRoutes, /app\.put\("\/api\/music\/playlists\/:id\/tracks"[\s\S]*?playlist\.accountId !== auth\.accountId[\s\S]*?channel: \{ kind: "music" \}/);
  assert.match(musicRoutes, /app\.post\("\/api\/music\/playlists\/:id\/share"[\s\S]*?channel\.kind !== "standard" && channel\.kind !== "direct"/);
  assert.match(musicRoutes, /type: "music_playlist"[\s\S]*?musicPlaylistShare\.create/);
});

test("playback state validates shared playlist access and rejects stale writers", () => {
  assert.match(musicRoutes, /app\.put\("\/api\/music\/playback-state"[\s\S]*?knownUpdatedAt[\s\S]*?accepted: false/);
  assert.match(musicRoutes, /body\.sourceKind === "playlist"[\s\S]*?canAccessPlaylist/);
  assert.match(musicRoutes, /body\.sourceKind === "favorites"[\s\S]*?musicFavorite\.findUnique/);
  assert.match(musicRoutes, /app\.delete\("\/api\/music\/playlists\/:id"[\s\S]*?musicPlaybackState\.updateMany[\s\S]*?sourceKind: "library"/);
});

test("media and Bible responses expose conditional validators", () => {
  assert.match(server, /function applyFileValidation[\s\S]*?ETag[\s\S]*?Last-Modified[\s\S]*?private, no-cache/);
  assert.match(server, /api\/bible\/chapter[\s\S]*?applyJsonValidation/);
  assert.match(musicRoutes, /api\/music\/tracks\/:id\/stream[\s\S]*?applyFileValidation/);
  assert.match(server, /app\.get\("\/avatars\/:file"[\s\S]*?applyFileValidation/);
  assert.match(server, /app\.get<\{ Params: \{ kit: string; file: string \} \}>\("\/api\/parallax\/:kit\/:file"[\s\S]*?applyFileValidation/);
});

test("Bible favorites persist a validated colorful underline choice", () => {
  assert.match(schema, /model BibleFavorite \{[\s\S]*?color\s+String\s+@default\("#f28b82"\)/);
  assert.match(server, /app\.post\("\/api\/bible\/favorites"[\s\S]*?normalizeBibleFavoriteColor[\s\S]*?color/);
  assert.match(server, /prisma\.bibleFavorite\.updateMany[\s\S]*?data: \{ color \}/);
  assert.match(server, /listBibleFavorites[\s\S]*?color: normalizeBibleFavoriteColor\(row\.color\)/);
});

test("the music channel is visible and uploadable for every authenticated account", () => {
  assert.match(server, /async function canAccessChannel[\s\S]*?channel\.kind === "music"\) return true/);
  assert.match(server, /async function canWriteChannel[\s\S]*?channel\.kind === "music"\) return true/);
  assert.match(server, /app\.get\("\/api\/channels"[\s\S]*?channelListWhere\(auth\.accountId\)/);
  assert.match(server, /function channelListWhere[\s\S]*?\{ kind: "music" \}/);
  assert.match(server, /io\.on\("connection"[\s\S]*?\{ kind: "music" \}/);
  assert.doesNotMatch(server, /channel\?\.kind === "music" && \(!canManageMusic\(auth\)/);
});

test("music and score mutations allow global managers or the original uploader", () => {
  for (const route of [
    'app.patch("/api/music/tracks/:id"',
    'app.delete("/api/music/tracks/:id"',
    'app.put("/api/music/tracks/:id/info"',
    'app.put("/api/music/tracks/:id/lyrics"',
    'app.delete("/api/music/tracks/:id/lyrics"',
    'app.put("/api/music/tracks/:id/score"'
  ]) {
    const start = musicRoutes.indexOf(route);
    assert.notEqual(start, -1, `missing ${route}`);
    assert.match(musicRoutes.slice(start, start + 3200), /canManageMusicAsset\(auth,/);
  }
  for (const route of [
    'app.patch("/api/music/scores/:id"',
    'app.delete("/api/music/scores/:id"',
    'app.patch("/api/music/scores/:id/pages"',
    'app.delete("/api/music/scores/:id/pages/:pageId"'
  ]) {
    const start = musicRoutes.indexOf(route);
    assert.notEqual(start, -1, `missing ${route}`);
    assert.match(musicRoutes.slice(start, start + 3200), /canManageScore\(auth,/);
  }
  assert.match(musicRoutes, /function canManageScore[\s\S]*?canManageMusicAsset\(auth, score\.track\?\.sender\.accountId\)/);
  assert.match(musicService, /function serializeTrack[\s\S]*?canManage,/);
});

test("the main application registers music routes without retaining endpoint bodies", () => {
  assert.match(server, /registerMusicRoutes\(app, \{/);
  assert.doesNotMatch(server, /app\.(?:get|post|put|patch|delete)\("\/api\/music/);
});
