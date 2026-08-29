import type { BibleVerseLineDTO } from "@shared/types";

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
