import assert from "node:assert/strict";
import test from "node:test";
import type { BibleLookupDTO, BibleRelatedSearchDTO } from "@shared/types";
import {
  BIBLE_SEARCH_HISTORY_LIMIT,
  bibleWorkspaceSnapshot,
  bibleWorkspaceStateFromSnapshot,
  bibleWorkspaceStateNewer,
  bibleWorkspaceStorageKey,
  findBibleTopicHistory,
  loadBibleWorkspaceState,
  mergeBibleTopicResults,
  normalizeBibleSearchQuery,
  saveBibleWorkspaceState,
  upsertBibleSearchHistory,
  type BibleSearchHistoryEntry,
  type BibleWorkspaceState
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

function readerState(updatedAt: string): BibleWorkspaceState {
  return {
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
        book: { code: "MAT", name: "马太福音", chapterCount: 28 },
        visibleChapter: 3,
        targetVerse: { chapter: 3, verse: 13, endVerse: 17, matches: [] },
        scrollAnchor: null,
        selectedVerseKeys: ["MAT:3:13"],
        selectionAnchorKey: "MAT:3:13",
        backStack: []
      },
      {
        id: "pane-b",
        book: { code: "MRK", name: "马可福音", chapterCount: 16 },
        visibleChapter: 1,
        targetVerse: null,
        scrollAnchor: null,
        selectedVerseKeys: [],
        selectionAnchorKey: null,
        backStack: [{ book: { code: "MAT", name: "马太福音", chapterCount: 28 }, visibleChapter: 3, targetVerse: null, scrollAnchor: null }]
      }
    ],
    activePaneId: "pane-b",
    receivingPaneId: "pane-b",
    orientation: "columns",
    paneSizes: [50, 50],
    history: [topicEntry("信心", ["希伯来书 11:1"])],
    updatedAt
  };
}

test("workspace snapshot keeps the pane layout and restores with device-local search fields", () => {
  const state = readerState("2026-09-02T10:00:00.000Z");
  const snapshot = bibleWorkspaceSnapshot(state, "2026-09-02T10:00:00.000Z");
  assert.equal(snapshot.view, "reader");
  assert.equal(snapshot.panes.length, 2);
  assert.equal(snapshot.panes[1]?.book.code, "MRK");
  assert.equal(snapshot.panes[1]?.backStack.length, 1);
  assert.equal(snapshot.receivingPaneId, "pane-b");
  assert.equal(snapshot.updatedAt, "2026-09-02T10:00:00.000Z");

  const restored = bibleWorkspaceStateFromSnapshot(snapshot, state);
  assert.equal(restored.view, "reader");
  assert.equal(restored.panes[1]?.book.code, "MRK");
  assert.equal(restored.receivingPaneId, "pane-b");
  assert.deepEqual(restored.paneSizes, [50, 50]);
  // 快照不含选中等瞬时状态，搜索历史保留设备本地版本
  assert.deepEqual(restored.panes[0]?.selectedVerseKeys, []);
  assert.equal(restored.textQuery, "葡萄园");
  assert.equal(restored.history[0]?.query, "信心");
});

test("bibleWorkspaceStateNewer prefers the state with the latest updatedAt", () => {
  const older = readerState("2026-09-02T09:00:00.000Z");
  const newer = readerState("2026-09-02T11:00:00.000Z");
  assert.equal(bibleWorkspaceStateNewer(older, newer), newer);
  assert.equal(bibleWorkspaceStateNewer(newer, older), newer);
  assert.equal(bibleWorkspaceStateNewer(older, null), older);
  assert.equal(bibleWorkspaceStateNewer(null, newer), newer);
  assert.equal(bibleWorkspaceStateNewer(null, null), null);
  const withoutTimestamp = { ...older };
  delete withoutTimestamp.updatedAt;
  assert.equal(bibleWorkspaceStateNewer(withoutTimestamp, newer), newer);
});

test("pane translation round-trips through storage and account snapshots", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => values.set(key, value)
  };
  const state = readerState("2026-09-03T02:00:00.000Z");
  state.panes[0]!.translation = "cmncbs";
  saveBibleWorkspaceState(storage, 34, state);

  const restored = loadBibleWorkspaceState(storage, 34);
  assert.equal(restored?.panes[0]?.translation, "cmncbs");
  assert.equal(restored?.panes[1]?.translation, undefined);

  const snapshot = bibleWorkspaceSnapshot(restored!, "2026-09-03T02:00:00.000Z");
  assert.equal(snapshot.panes[0]?.translation, "cmncbs");
  assert.equal(snapshot.panes[1]?.translation, undefined);

  const fromSnapshot = bibleWorkspaceStateFromSnapshot(snapshot, null);
  assert.equal(fromSnapshot.panes[0]?.translation, "cmncbs");
});

test("sanitize drops non-string pane translations", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => values.set(key, value)
  };
  const state = readerState("2026-09-03T02:00:00.000Z");
  (state.panes[0] as unknown as { translation: unknown }).translation = 42;
  saveBibleWorkspaceState(storage, 34, state);
  assert.equal(loadBibleWorkspaceState(storage, 34)?.panes[0]?.translation, undefined);
});
