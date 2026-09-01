import type {
  BibleBookCatalogDTO,
  BibleRelatedSearchDTO,
  BibleTextMatchRangeDTO,
  BibleTextSearchDTO
} from "@shared/types";
import { MAX_BIBLE_PANES, normalizeBiblePaneSizes, type BibleSplitOrientation } from "./bibleSplitLayout";

export type BibleWorkspaceView = "home" | "chapters" | "reader";
export type BibleWorkspaceSearchMode = "topic" | "text";

export type BibleTopicSearchHistoryEntry = {
  kind: "topic";
  query: string;
  updatedAt: string;
  result: BibleRelatedSearchDTO;
};

export type BibleTextSearchHistoryEntry = {
  kind: "text";
  query: string;
  updatedAt: string;
  result: BibleTextSearchDTO;
};

export type BibleSearchHistoryEntry = BibleTopicSearchHistoryEntry | BibleTextSearchHistoryEntry;

export type BibleReaderTarget = {
  chapter: number;
  verse: number;
  endVerse: number;
  matches: BibleTextMatchRangeDTO[];
};

export type BiblePaneScrollAnchor = {
  chapter: number;
  verse: number | null;
  offset: number;
};

export type BiblePaneLocationState = {
  book: BibleBookCatalogDTO;
  visibleChapter: number;
  targetVerse: BibleReaderTarget | null;
  scrollAnchor: BiblePaneScrollAnchor | null;
};

export type BiblePaneState = BiblePaneLocationState & {
  id: string;
  selectedVerseKeys: string[];
  selectionAnchorKey: string | null;
  backStack: BiblePaneLocationState[];
};

export type BibleWorkspaceStateV1 = {
  version: 1;
  view: BibleWorkspaceView;
  searchMode: BibleWorkspaceSearchMode;
  topicQuery: string;
  textQuery: string;
  topicResult: BibleRelatedSearchDTO | null;
  textResult: BibleTextSearchDTO | null;
  selectedBook: BibleBookCatalogDTO | null;
  readerBook: BibleBookCatalogDTO | null;
  visibleChapter: number;
  targetVerse: BibleReaderTarget | null;
  selectedVerseReference: string | null;
  selectedVerseKeys?: string[];
  selectionAnchorKey?: string | null;
  history: BibleSearchHistoryEntry[];
};

export type BibleWorkspaceState = {
  version: 2;
  view: BibleWorkspaceView;
  searchMode: BibleWorkspaceSearchMode;
  topicQuery: string;
  textQuery: string;
  topicResult: BibleRelatedSearchDTO | null;
  textResult: BibleTextSearchDTO | null;
  selectedBook: BibleBookCatalogDTO | null;
  panes: BiblePaneState[];
  activePaneId: string | null;
  receivingPaneId: string | null;
  orientation: BibleSplitOrientation | null;
  paneSizes: number[];
  history: BibleSearchHistoryEntry[];
};

export const BIBLE_SEARCH_HISTORY_LIMIT = 20;
const BIBLE_TEXT_HISTORY_ITEM_LIMIT = 50;

export function bibleWorkspaceStorageKey(accountId: number) {
  return `tm3:bible-workspace:v1:${accountId}`;
}

export function normalizeBibleSearchQuery(query: string) {
  return query.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function upsertBibleSearchHistory(history: BibleSearchHistoryEntry[], entry: BibleSearchHistoryEntry) {
  const normalized = normalizeBibleSearchQuery(entry.query);
  const compactEntry = compactHistoryEntry(entry);
  return [
    compactEntry,
    ...history.filter((item) => item.kind !== entry.kind || normalizeBibleSearchQuery(item.query) !== normalized)
  ].slice(0, BIBLE_SEARCH_HISTORY_LIMIT);
}

export function findBibleTopicHistory(history: BibleSearchHistoryEntry[], query: string) {
  const normalized = normalizeBibleSearchQuery(query);
  if (!normalized) return null;
  return history.find((item): item is BibleTopicSearchHistoryEntry => item.kind === "topic" && normalizeBibleSearchQuery(item.query) === normalized) || null;
}

export function mergeBibleTopicResults(current: BibleRelatedSearchDTO, incoming: BibleRelatedSearchDTO): BibleRelatedSearchDTO {
  const seen = new Set<string>();
  const results = [...current.results, ...incoming.results].filter((lookup) => {
    if (seen.has(lookup.normalizedReference)) return false;
    seen.add(lookup.normalizedReference);
    return true;
  });
  return { query: current.query, results };
}

export function loadBibleWorkspaceState(storage: Pick<Storage, "getItem">, accountId: number): BibleWorkspaceState | null {
  if (!accountId) return null;
  try {
    const raw = storage.getItem(bibleWorkspaceStorageKey(accountId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BibleWorkspaceState | BibleWorkspaceStateV1>;
    if (!Array.isArray(parsed.history)) return null;
    if (parsed.version === 1) return migrateLegacyWorkspaceState(parsed as BibleWorkspaceStateV1);
    if (parsed.version !== 2 || !Array.isArray(parsed.panes)) return null;
    return sanitizeWorkspaceState(parsed as BibleWorkspaceState);
  } catch {
    return null;
  }
}

export function saveBibleWorkspaceState(
  storage: Pick<Storage, "setItem">,
  accountId: number,
  state: BibleWorkspaceState | BibleWorkspaceStateV1
) {
  if (!accountId) return;
  const current = state.version === 1 ? migrateLegacyWorkspaceState(state) : sanitizeWorkspaceState(state);
  const compactState: BibleWorkspaceState = {
    ...current,
    textResult: current.textResult ? compactTextResult(current.textResult) : null,
    panes: current.panes.map((pane) => ({ ...pane, backStack: pane.backStack.slice(-20) })),
    history: current.history.slice(0, BIBLE_SEARCH_HISTORY_LIMIT).map(compactHistoryEntry)
  };
  storage.setItem(bibleWorkspaceStorageKey(accountId), JSON.stringify(compactState));
}

function migrateLegacyWorkspaceState(state: BibleWorkspaceStateV1): BibleWorkspaceState {
  const panes: BiblePaneState[] = state.readerBook ? [{
    id: "pane-a",
    book: state.readerBook,
    visibleChapter: Math.max(1, state.visibleChapter || 1),
    targetVerse: state.targetVerse || null,
    scrollAnchor: null,
    selectedVerseKeys: state.selectedVerseKeys || [],
    selectionAnchorKey: state.selectionAnchorKey || null,
    backStack: []
  }] : [];
  return {
    version: 2,
    view: state.view === "reader" && !panes.length ? "home" : state.view,
    searchMode: state.searchMode,
    topicQuery: state.topicQuery,
    textQuery: state.textQuery,
    topicResult: state.topicResult,
    textResult: state.textResult,
    selectedBook: state.selectedBook,
    panes,
    activePaneId: panes[0]?.id || null,
    receivingPaneId: null,
    orientation: null,
    paneSizes: normalizeBiblePaneSizes([], panes.length || 1),
    history: state.history
  };
}

function sanitizeWorkspaceState(state: BibleWorkspaceState): BibleWorkspaceState {
  const seenIds = new Set<string>();
  const panes = state.panes.slice(0, MAX_BIBLE_PANES).filter((pane) => {
    if (!pane?.id || !pane.book || seenIds.has(pane.id)) return false;
    seenIds.add(pane.id);
    return true;
  }).map((pane) => ({
    ...pane,
    visibleChapter: Math.max(1, Math.min(pane.book.chapterCount, Math.floor(pane.visibleChapter) || 1)),
    selectedVerseKeys: Array.isArray(pane.selectedVerseKeys) ? pane.selectedVerseKeys : [],
    selectionAnchorKey: pane.selectionAnchorKey || null,
    scrollAnchor: pane.scrollAnchor || null,
    backStack: Array.isArray(pane.backStack) ? pane.backStack.slice(-20) : []
  }));
  const ids = new Set(panes.map((pane) => pane.id));
  return {
    ...state,
    version: 2,
    view: state.view === "reader" && !panes.length ? "home" : state.view,
    panes,
    activePaneId: state.activePaneId && ids.has(state.activePaneId) ? state.activePaneId : panes[0]?.id || null,
    receivingPaneId: state.receivingPaneId && ids.has(state.receivingPaneId) ? state.receivingPaneId : null,
    orientation: state.orientation === "columns" || state.orientation === "rows" ? state.orientation : null,
    paneSizes: normalizeBiblePaneSizes(state.paneSizes || [], panes.length || 1),
    history: Array.isArray(state.history) ? state.history : []
  };
}

function compactHistoryEntry(entry: BibleSearchHistoryEntry): BibleSearchHistoryEntry {
  if (entry.kind === "topic") return entry;
  return { ...entry, result: compactTextResult(entry.result) };
}

function compactTextResult(result: BibleTextSearchDTO): BibleTextSearchDTO {
  return { ...result, items: result.items.slice(0, BIBLE_TEXT_HISTORY_ITEM_LIMIT) };
}
