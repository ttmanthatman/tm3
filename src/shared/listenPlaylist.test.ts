import assert from "node:assert/strict";
import test from "node:test";
import {
  LISTEN_PLAYLIST_ITEM_MAX,
  listenPlaylistContent,
  listenPlaylistCountLabel,
  listenPlaylistPayload,
  type ListenPlaylistItem
} from "./listenPlaylist.js";

const psalm: ListenPlaylistItem = {
  kind: "scripture",
  reference: "诗篇 23:1-6",
  bookCode: "PSA",
  bookName: "诗篇",
  startChapter: 23,
  startVerse: 1,
  endChapter: 23,
  endVerse: 6
};
const song: ListenPlaylistItem = { kind: "track", trackId: 42, title: "奇异恩典" };

test("listen playlist payload accepts scripture and track items in order", () => {
  const payload = listenPlaylistPayload({ kind: "listen_playlist", translation: "和合本", items: [psalm, song], note: "  晚祷  " });
  assert.ok(payload);
  assert.deepEqual(payload.items, [psalm, song]);
  assert.equal(payload.note, "晚祷");
  assert.equal(payload.translation, "和合本");
});

test("listen playlist payload rejects foreign kinds, empty lists and malformed items", () => {
  assert.equal(listenPlaylistPayload({ kind: "bible_topic", translation: "x", items: [psalm] }), null);
  assert.equal(listenPlaylistPayload({ kind: "listen_playlist", translation: "x", items: [] }), null);
  assert.equal(listenPlaylistPayload({ kind: "listen_playlist", items: [psalm] }), null);
  assert.equal(listenPlaylistPayload({ kind: "listen_playlist", translation: "x", items: [{ kind: "track", trackId: 0, title: "a" }] }), null);
  assert.equal(listenPlaylistPayload({ kind: "listen_playlist", translation: "x", items: [{ ...psalm, startChapter: "23" }] }), null);
  const tooMany = Array.from({ length: LISTEN_PLAYLIST_ITEM_MAX + 1 }, () => song);
  assert.equal(listenPlaylistPayload({ kind: "listen_playlist", translation: "x", items: tooMany }), null);
});

test("listen playlist payload keeps chapter introductions (verse 0) playable", () => {
  const payload = listenPlaylistPayload({ kind: "listen_playlist", translation: "x", items: [{ ...psalm, startVerse: 0 }] });
  assert.equal(payload?.items[0]?.kind === "scripture" ? payload.items[0].startVerse : -1, 0);
});

test("listen playlist content and count labels summarize the queue", () => {
  assert.equal(listenPlaylistContent([psalm, song]), "一起听：诗篇 23:1-6 · ♪奇异恩典");
  assert.equal(listenPlaylistContent([song], " 睡前听 "), "一起听：♪奇异恩典\n睡前听");
  assert.equal(listenPlaylistCountLabel([psalm, song, song]), "1 段经文 · 2 首歌");
  assert.equal(listenPlaylistCountLabel([psalm]), "1 段经文");
});
