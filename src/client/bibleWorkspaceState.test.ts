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
  assert.equal(restored?.readerBook?.code, "PHP");
  assert.equal(restored?.visibleChapter, 4);
  assert.equal(restored?.history[0]?.query, "焦虑");
});
