import type { BibleBookCatalogDTO, BibleCatalogDTO, BibleVerseLineDTO } from "@shared/types";

interface SermonContextScrollState {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  firstChapter: number;
  lastChapter: number;
  chapterCount: number;
}

export function sermonContextBookForVerse(
  catalog: BibleCatalogDTO,
  book: string
): BibleBookCatalogDTO | undefined {
  const normalizedBook = book.trim().toUpperCase();
  return [...catalog.oldTestament, ...catalog.newTestament].find((entry) =>
    entry.name === book.trim() || entry.code.toUpperCase() === normalizedBook
  );
}

export function sermonContextInitialChapterNumbers(chapter: number, chapterCount: number): number[] {
  return [chapter - 1, chapter, chapter + 1]
    .filter((candidate) => candidate >= 1 && candidate <= chapterCount);
}

export function sermonContextScrollChapterTargets(state: SermonContextScrollState): {
  previous: number | null;
  next: number | null;
} {
  return {
    previous: state.scrollTop < 220 && state.firstChapter > 1 ? state.firstChapter - 1 : null,
    next: state.scrollHeight - state.scrollTop - state.clientHeight < 320 && state.lastChapter < state.chapterCount
      ? state.lastChapter + 1
      : null
  };
}

export function sermonContextVerseIsCurrent(
  verse: BibleVerseLineDTO,
  selectedVerses: readonly BibleVerseLineDTO[]
): boolean {
  return selectedVerses.some((selected) =>
    verse.book === selected.book
    && verse.chapter === selected.chapter
    && verse.verse <= selected.endVerse
    && selected.verse <= verse.endVerse
  );
}
