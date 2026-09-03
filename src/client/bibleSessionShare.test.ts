import assert from "node:assert/strict";
import test from "node:test";
import { bibleSessionPaneLabel, buildBibleSessionSharePayload, parseBibleSessionPayload } from "./bibleSessionShare";
import type { BiblePaneState } from "./bibleWorkspaceState";

function pane(
  id: string,
  book: { code: string; name: string; chapterCount: number },
  chapter: number,
  targetVerse: BiblePaneState["targetVerse"] = null
): BiblePaneState {
  return {
    id,
    book,
    visibleChapter: chapter,
    targetVerse,
    scrollAnchor: null,
    selectedVerseKeys: [],
    selectionAnchorKey: null,
    backStack: []
  };
}

const matthew = { code: "MAT", name: "马太福音", chapterCount: 28 };
const mark = { code: "MRK", name: "马可福音", chapterCount: 16 };

test("bible session share payload round-trips through build and parse", () => {
  const payload = buildBibleSessionSharePayload(
    [
      pane("pane-a", matthew, 3, { chapter: 3, verse: 13, endVerse: 17, matches: [] }),
      pane("pane-b", mark, 1, { chapter: 1, verse: 9, endVerse: 11, matches: [] })
    ],
    "columns",
    "pane-b",
    "新标点和合本（简体）"
  );
  assert.ok(payload);
  assert.equal(payload.receivingIndex, 1);
  const parsed = parseBibleSessionPayload(JSON.parse(JSON.stringify(payload)));
  assert.deepEqual(parsed, payload);
});

test("bible session share payload drops a target verse outside the visible chapter", () => {
  const payload = buildBibleSessionSharePayload(
    [pane("pane-a", matthew, 3, { chapter: 4, verse: 1, endVerse: 11, matches: [] })],
    null,
    null,
    "新标点和合本（简体）"
  );
  assert.ok(payload);
  assert.equal(payload.panes[0]?.verseStart, null);
  assert.equal(payload.receivingIndex, null);
});

test("buildBibleSessionSharePayload returns null without panes", () => {
  assert.equal(buildBibleSessionSharePayload([], null, null, ""), null);
});

test("parseBibleSessionPayload rejects malformed payloads", () => {
  assert.equal(parseBibleSessionPayload(null), null);
  assert.equal(parseBibleSessionPayload("bible"), null);
  assert.equal(parseBibleSessionPayload({ kind: "other", panes: [] }), null);
  assert.equal(parseBibleSessionPayload({ kind: "bible_session", panes: [] }), null);
  assert.equal(parseBibleSessionPayload({ kind: "bible_session", panes: [{ bookCode: "MAT", chapter: 3 }] }), null);
  assert.equal(parseBibleSessionPayload({ kind: "bible_session", panes: [{ bookCode: "MAT", bookName: "马太福音", chapter: 0 }] }), null);
});

test("parseBibleSessionPayload normalizes orientation and receiving index", () => {
  const parsed = parseBibleSessionPayload({
    kind: "bible_session",
    translation: "新标点和合本（简体）",
    orientation: "grid",
    receivingIndex: 5,
    panes: [{ bookCode: "MAT", bookName: "马太福音", chapter: 3, verseStart: 13, verseEnd: 17 }],
    description: " 一起读 "
  });
  assert.ok(parsed);
  assert.equal(parsed.orientation, null);
  assert.equal(parsed.receivingIndex, null);
  assert.equal(parsed.description, "一起读");
});

test("bibleSessionPaneLabel formats chapters and verse ranges", () => {
  assert.equal(bibleSessionPaneLabel({ bookCode: "MAT", bookName: "马太福音", chapter: 3 }), "马太福音 3章");
  assert.equal(bibleSessionPaneLabel({ bookCode: "MAT", bookName: "马太福音", chapter: 3, verseStart: 13, verseEnd: 17 }), "马太福音 3:13-17");
  assert.equal(bibleSessionPaneLabel({ bookCode: "MAT", bookName: "马太福音", chapter: 3, verseStart: 13, verseEnd: 13 }), "马太福音 3:13");
});

test("bible session share payload keeps per-pane translations", () => {
  const first = pane("pane-a", matthew, 3);
  first.translation = "cmncbs";
  const payload = buildBibleSessionSharePayload([first, pane("pane-b", mark, 1)], null, null, "新标点和合本（简体）");
  assert.ok(payload);
  assert.equal(payload.panes[0]?.translation, "cmncbs");
  assert.equal(payload.panes[1]?.translation, undefined);

  const parsed = parseBibleSessionPayload(JSON.parse(JSON.stringify(payload)));
  assert.deepEqual(parsed, payload);
  assert.equal(parsed?.panes[0]?.translation, "cmncbs");
});
