import assert from "node:assert/strict";
import test from "node:test";
import type { BibleLookupDTO, BibleRelatedSearchDTO } from "@shared/types";
import {
  BIBLE_SEARCH_HISTORY_LIMIT,
  bibleWorkspaceStorageKey,
  findBibleTopicHistory,
  loadBibleWorkspaceState,
  mergeBibleTopicResults,
  normalizeBibleSearchQuery,
  saveBibleWorkspaceState,
  upsertBibleSearchHistory,
  type BibleSearchHistoryEntry
} from "./bibleWorkspaceState";

function lookup(reference: string): BibleLookupDTO {
  return {
    reference,
    normalizedReference: reference,
    translation: "新标点和合本（简体）",
    sourceId: "cmn-cu89s",
    verses: []
  };
}

function topicEntry(query: string, references: string[]): BibleSearchHistoryEntry {
  return {
    kind: "topic",
    query,
    updatedAt: "2026-07-15T00:00:00.000Z",
    result: { query, results: references.map(lookup) }
  };
}

test("Bible search history matches repeated AI queries after whitespace and case normalization", () => {
  const history = [topicEntry("Faith and Hope", ["希伯来书 11:1"])];
  assert.equal(normalizeBibleSearchQuery("  FAITH   and hope "), "faith and hope");
  assert.equal(findBibleTopicHistory(history, " faith AND hope ")?.result.results[0]?.normalizedReference, "希伯来书 11:1");
});

test("Bible search history replaces repeated queries and remains bounded", () => {
  let history: BibleSearchHistoryEntry[] = [];
  for (let index = 0; index < BIBLE_SEARCH_HISTORY_LIMIT + 5; index += 1) {
    history = upsertBibleSearchHistory(history, topicEntry(`主题 ${index}`, [`诗篇 ${index + 1}:1`]));
  }
  history = upsertBibleSearchHistory(history, topicEntry("主题 24", ["约翰福音 3:16"]));
  assert.equal(history.length, BIBLE_SEARCH_HISTORY_LIMIT);
  assert.equal(history[0]?.query, "主题 24");
  assert.equal((history[0] as Extract<BibleSearchHistoryEntry, { kind: "topic" }>).result.results[0]?.normalizedReference, "约翰福音 3:16");
});

test("append generation keeps existing passages and only adds new references", () => {
  const current: BibleRelatedSearchDTO = { query: "盼望", results: [lookup("罗马书 5:5"), lookup("罗马书 15:13")] };
  const incoming: BibleRelatedSearchDTO = { query: "盼望", results: [lookup("罗马书 15:13"), lookup("耶利米书 29:11")] };
  assert.deepEqual(mergeBibleTopicResults(current, incoming).results.map((item) => item.normalizedReference), [
    "罗马书 5:5",
    "罗马书 15:13",
    "耶利米书 29:11"
  ]);
});

test("Bible workspace storage is isolated per account", () => {
  assert.notEqual(bibleWorkspaceStorageKey(12), bibleWorkspaceStorageKey(13));
});

test("Bible workspace round-trips the active reader and search state", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => values.set(key, value)
  };
  saveBibleWorkspaceState(storage, 12, {
    version: 1,
    view: "reader",
    searchMode: "topic",
    topicQuery: "焦虑",
    textQuery: "",
    topicResult: { query: "焦虑", results: [lookup("腓立比书 4:6-7")] },
    textResult: null,
    selectedBook: null,
    readerBook: { code: "PHP", name: "腓立比书", chapterCount: 4 },
    visibleChapter: 4,
    targetVerse: { chapter: 4, verse: 6, endVerse: 7, matches: [] },
    selectedVerseReference: "腓立比书 4:6",
    history: [topicEntry("焦虑", ["腓立比书 4:6-7"])]
  });
  const restored = loadBibleWorkspaceState(storage, 12);
  assert.equal(restored?.view, "reader");
  assert.equal(restored?.panes[0]?.book.code, "PHP");
  assert.equal(restored?.panes[0]?.visibleChapter, 4);
  assert.equal(restored?.history[0]?.query, "焦虑");
});

test("legacy single-reader state migrates to a four-pane-capable workspace", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => values.set(key, value)
  };
  storage.setItem(bibleWorkspaceStorageKey(21), JSON.stringify({
    version: 1,
    view: "reader",
    searchMode: "topic",
    topicQuery: "",
    textQuery: "",
    topicResult: null,
    textResult: null,
    selectedBook: null,
    readerBook: { code: "MAT", name: "马太福音", chapterCount: 28 },
    visibleChapter: 21,
    targetVerse: null,
    selectedVerseReference: null,
    history: []
  }));

  const restored = loadBibleWorkspaceState(storage, 21);
  assert.equal(restored?.version, 2);
  assert.equal(restored?.panes.length, 1);
  assert.equal(restored?.panes[0]?.book?.code, "MAT");
  assert.equal(restored?.panes[0]?.visibleChapter, 21);
  assert.equal(restored?.orientation, null);
  assert.equal(restored?.receivingPaneId, null);
});

test("split pane state preserves the receiver, orientation, sizes, anchors, and back stack", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => values.set(key, value)
  };
  const book = { code: "MAT", name: "马太福音", chapterCount: 28 };
  saveBibleWorkspaceState(storage, 34, {
    version: 2,
    view: "reader",
    searchMode: "text",
    topicQuery: "",
    textQuery: "葡萄园",
    topicResult: null,
    textResult: null,
    selectedBook: null,
    panes: [
      {
        id: "pane-a",
        book,
        visibleChapter: 21,
        targetVerse: null,
        scrollAnchor: { chapter: 21, verse: 33, offset: 72.5 },
        selectedVerseKeys: [],
        selectionAnchorKey: null,
        backStack: []
      },
      {
        id: "pane-b",
        book,
        visibleChapter: 22,
        targetVerse: { chapter: 22, verse: 15, endVerse: 22, matches: [] },
        scrollAnchor: null,
        selectedVerseKeys: [],
        selectionAnchorKey: null,
        backStack: [{ book, visibleChapter: 21, targetVerse: null, scrollAnchor: { chapter: 21, verse: 33, offset: 72.5 } }]
      }
    ],
    activePaneId: "pane-b",
    receivingPaneId: "pane-a",
    orientation: "columns",
    paneSizes: [62, 38],
    history: []
  });

  const restored = loadBibleWorkspaceState(storage, 34);
  assert.equal(restored?.activePaneId, "pane-b");
  assert.equal(restored?.receivingPaneId, "pane-a");
  assert.equal(restored?.orientation, "columns");
  assert.deepEqual(restored?.paneSizes, [62, 38]);
  assert.deepEqual(restored?.panes[0]?.scrollAnchor, { chapter: 21, verse: 33, offset: 72.5 });
  assert.equal(restored?.panes[1]?.backStack[0]?.visibleChapter, 21);
});
