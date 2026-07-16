import type {
  BibleBookCatalogDTO,
  BibleRelatedSearchDTO,
  BibleTextMatchRangeDTO,
  BibleTextSearchDTO
} from "@shared/types";

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

export type BibleWorkspaceState = {
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
    const parsed = JSON.parse(raw) as Partial<BibleWorkspaceState>;
    if (parsed.version !== 1 || !Array.isArray(parsed.history)) return null;
    return parsed as BibleWorkspaceState;
  } catch {
    return null;
  }
}

export function saveBibleWorkspaceState(storage: Pick<Storage, "setItem">, accountId: number, state: BibleWorkspaceState) {
  if (!accountId) return;
  const compactState: BibleWorkspaceState = {
    ...state,
    textResult: state.textResult ? compactTextResult(state.textResult) : null,
    history: state.history.slice(0, BIBLE_SEARCH_HISTORY_LIMIT).map(compactHistoryEntry)
  };
  storage.setItem(bibleWorkspaceStorageKey(accountId), JSON.stringify(compactState));
}

function compactHistoryEntry(entry: BibleSearchHistoryEntry): BibleSearchHistoryEntry {
  if (entry.kind === "topic") return entry;
  return { ...entry, result: compactTextResult(entry.result) };
}

function compactTextResult(result: BibleTextSearchDTO): BibleTextSearchDTO {
  return { ...result, items: result.items.slice(0, BIBLE_TEXT_HISTORY_ITEM_LIMIT) };
}
