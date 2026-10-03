import assert from "node:assert/strict";
import test from "node:test";
import { copyworkSource } from "./bibleCopyworks.js";
import { parseCopyworkBackup } from "./bibleCopyworkBackup.js";
const selection = {
  translation: "cmn-cu89s",
  bookCode: "JHN",
  chapter: 11,
  verseStart: 35,
  verseEnd: 35
};
test("copywork source is canonical, translation-specific and limited to 500 characters", () => {
  const source = copyworkSource(selection);
  assert.match(source.text, /耶稣哭了/);
  assert.throws(() => copyworkSource({ ...selection, translation: "unknown" }));
  assert.throws(() => copyworkSource({ ...selection, verseEnd: 999 }));
  assert.throws(() => copyworkSource({ ...selection, chapter: 1, verseStart: 1, verseEnd: 51 }));
  assert.notEqual(
    copyworkSource({ ...selection, translation: "cmncbs" }).translation,
    source.translation
  );
});
test("backup rejects incomplete and corrupt character data before a transaction writes", () => {
  const source = copyworkSource(selection);
  const record = {
    ...selection,
    id: "8c6e6fda-f26b-4d19-9c64-b0c0bd4d1701",
    accountId: 1,
    spacing: "normal",
    source,
    createdAt: new Date(),
    completedAt: new Date(),
    publishedAt: null,
    glyphs: [],
    shares: []
  };
  assert.throws(() => parseCopyworkBackup([record]), /不完整/);
  assert.deepEqual(parseCopyworkBackup([]), []);
});
