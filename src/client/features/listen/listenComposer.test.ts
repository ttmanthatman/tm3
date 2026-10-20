import assert from "node:assert/strict";
import test from "node:test";
import { buildListenDraft } from "./listenComposer";

const grace = { id: 7, title: "奇异恩典" };
const home = { id: 8, title: "这世界非我家" };

test("listen draft keeps scripture and song order as written in the composer", () => {
  const draft = buildListenDraft("诗篇23 @@奇异恩典 约翰福音3:16 @@这世界非我家", [home, grace]);
  assert.deepEqual(draft.items, [
    { kind: "scripture", reference: "诗篇23" },
    { kind: "track", trackId: 7 },
    { kind: "scripture", reference: "约翰福音3:16" },
    { kind: "track", trackId: 8 }
  ]);
  assert.deepEqual(draft.preview.map((item) => (item.kind === "track" ? item.title : item.reference)), ["诗篇23", "奇异恩典", "约翰福音3:16", "这世界非我家"]);
  assert.equal(draft.note, "");
});

test("listen draft ignores mentions whose marker was deleted and keeps leftover words as the note", () => {
  const draft = buildListenDraft("今晚睡前一起听 诗篇 23 和 @@奇异恩典 🙏", [grace, home]);
  assert.deepEqual(draft.items, [
    { kind: "scripture", reference: "诗篇 23" },
    { kind: "track", trackId: 7 }
  ]);
  assert.equal(draft.note, "今晚睡前一起听 和 🙏");
});

test("listen draft does not read chapter numbers inside a song title", () => {
  const draft = buildListenDraft("@@诗篇23 这首歌 太5:3-7:12", [{ id: 3, title: "诗篇23" }]);
  assert.deepEqual(draft.items, [
    { kind: "track", trackId: 3 },
    { kind: "scripture", reference: "太5:3-7:12" }
  ]);
  assert.equal(draft.note, "这首歌");
});

test("listen draft handles the same song mentioned twice", () => {
  const draft = buildListenDraft("@@奇异恩典 诗篇23 @@奇异恩典", [grace, grace]);
  assert.deepEqual(draft.items, [
    { kind: "track", trackId: 7 },
    { kind: "scripture", reference: "诗篇23" },
    { kind: "track", trackId: 7 }
  ]);
});

test("an empty listen draft has no items", () => {
  assert.deepEqual(buildListenDraft("   ", []).items, []);
  assert.deepEqual(buildListenDraft("随便聊聊", []).items, []);
});
