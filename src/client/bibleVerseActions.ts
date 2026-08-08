import type { BibleLookupDTO, BibleVerseLineDTO } from "@shared/types";

export function bibleVerseKey(bookCode: string, verse: Pick<BibleVerseLineDTO, "chapter" | "verse">) {
  return `${bookCode.toUpperCase()}:${verse.chapter}:${verse.verse}`;
}

export function selectBibleVerseKeys(
  orderedKeys: string[],
  selectedKeys: ReadonlySet<string>,
  clickedKey: string,
  anchorKey: string | null,
  shiftKey: boolean
) {
  const next = new Set(selectedKeys);
  if (shiftKey && anchorKey) {
    const anchorIndex = orderedKeys.indexOf(anchorKey);
    const clickedIndex = orderedKeys.indexOf(clickedKey);
    if (anchorIndex >= 0 && clickedIndex >= 0) {
      const start = Math.min(anchorIndex, clickedIndex);
      const end = Math.max(anchorIndex, clickedIndex);
      for (const key of orderedKeys.slice(start, end + 1)) next.add(key);
      return next;
    }
  }
  if (next.has(clickedKey)) next.delete(clickedKey);
  else next.add(clickedKey);
  return next;
}

export function groupContinuousBibleVerses(verses: BibleVerseLineDTO[]) {
  const groups: BibleVerseLineDTO[][] = [];
  for (const verse of verses) {
    const current = groups[groups.length - 1];
    const previous = current?.[current.length - 1];
    if (current && previous && previous.book === verse.book && previous.chapter === verse.chapter && verse.verse <= previous.endVerse + 1) {
      current.push(verse);
    } else {
      groups.push([verse]);
    }
  }
  return groups;
}

export function bibleVerseGroupReference(group: BibleVerseLineDTO[]) {
  const first = group[0];
  const last = group[group.length - 1];
  const end = last.endVerse > first.verse ? `-${last.endVerse}` : "";
  return `${first.book} ${first.chapter}:${first.verse}${end}`;
}

export function formatBibleVersesForCopy(verses: BibleVerseLineDTO[], translation: string) {
  if (!verses.length) return "";
  const passages = groupContinuousBibleVerses(verses).map((group) => {
    return `${bibleVerseGroupReference(group)}\n${group.map((verse) => `${verse.verse} ${verse.text}`).join("\n")}`;
  });
  return `${passages.join("\n\n")}\n\n—— ${translation}`;
}

export function formatBibleLookupsForCopy(lookups: BibleLookupDTO[], fallbackTranslation: string) {
  if (!lookups.length) return "";
  const passages = lookups.map((lookup) => {
    const lines = lookup.verses.map((verse) => `${verse.verse} ${verse.text}`).join("\n");
    return `${lookup.normalizedReference}\n${lines}`;
  });
  return `${passages.join("\n\n")}\n\n—— ${lookups[0].translation || fallbackTranslation}`;
}
