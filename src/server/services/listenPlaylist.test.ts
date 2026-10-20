import assert from "node:assert/strict";
import test from "node:test";
import { cleanListenPlaylistPayload } from "./listenPlaylist.js";

const tracks = new Map([[7, { id: 7, title: "奇异恩典" }]]);
const resolveTrack = async (trackId: number) => tracks.get(trackId) || null;

test("listen playlist cleaner resolves references and tracks while keeping the composer order", async () => {
  const payload = await cleanListenPlaylistPayload({
    kind: "listen_playlist",
    items: [
      { kind: "scripture", reference: "诗篇 23" },
      { kind: "track", trackId: 7 },
      { kind: "scripture", reference: "约翰福音 3:16-17" }
    ],
    note: "  今晚一起听 "
  }, resolveTrack);
  assert.equal(payload.kind, "listen_playlist");
  assert.equal(payload.note, "今晚一起听");
  assert.ok(payload.translation);
  assert.equal(payload.items.length, 3);
  const [psalm, song, john] = payload.items;
  assert.equal(psalm.kind, "scripture");
  if (psalm.kind === "scripture") {
    assert.equal(psalm.bookCode, "PSA");
    assert.equal(psalm.bookName, "诗篇");
    assert.equal(psalm.startChapter, 23);
    assert.equal(psalm.startVerse, 1);
    assert.equal(psalm.endVerse, 6);
  }
  assert.deepEqual(song, { kind: "track", trackId: 7, title: "奇异恩典" });
  assert.equal(john.kind, "scripture");
  if (john.kind === "scripture") {
    assert.equal(john.bookCode, "JHN");
    assert.equal(john.startVerse, 16);
    assert.equal(john.endVerse, 17);
  }
});

test("listen playlist cleaner splits multi-passage references into separate items", async () => {
  const payload = await cleanListenPlaylistPayload({
    kind: "listen_playlist",
    items: [{ kind: "scripture", reference: "诗篇 23:1; 约翰福音 3:16" }]
  }, resolveTrack);
  assert.equal(payload.items.length, 2);
  assert.equal(payload.items[0].kind === "scripture" ? payload.items[0].bookCode : "", "PSA");
  assert.equal(payload.items[1].kind === "scripture" ? payload.items[1].bookCode : "", "JHN");
});

test("listen playlist cleaner rejects empty lists, unknown songs and unparseable references", async () => {
  await assert.rejects(cleanListenPlaylistPayload({ kind: "listen_playlist", items: [] }, resolveTrack), /至少/);
  await assert.rejects(cleanListenPlaylistPayload({ kind: "listen_playlist", items: [{ kind: "track", trackId: 99 }] }, resolveTrack), /不存在/);
  await assert.rejects(cleanListenPlaylistPayload({ kind: "listen_playlist", items: [{ kind: "scripture", reference: "随便写的" }] }, resolveTrack), /无法识别/);
  await assert.rejects(cleanListenPlaylistPayload({ kind: "listen_playlist", items: [{ kind: "video", id: 1 }] }, resolveTrack), /无效/);
});
