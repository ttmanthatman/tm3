import type { BibleFavoriteDTO, BibleLookupDTO } from "../shared/types.js";

export type BibleFavoritePassage = {
  key: string;
  favoriteIds: number[];
  favorites: BibleFavoriteDTO[];
  savedAt: string;
  lookup: BibleLookupDTO;
};

function passageReference(favorites: BibleFavoriteDTO[]) {
  const first = favorites[0].verseLine;
  const last = favorites[favorites.length - 1].verseLine;
  const verseRange = first.verse === last.endVerse ? String(first.verse) : `${first.verse}-${last.endVerse}`;
  return `${first.book} ${first.chapter}:${verseRange}`;
}

export function groupBibleFavoritePassages(favorites: readonly BibleFavoriteDTO[]): BibleFavoritePassage[] {
  const buckets = new Map<string, { firstIndex: number; favorites: BibleFavoriteDTO[] }>();
  favorites.forEach((favorite, index) => {
    const key = `${favorite.bookCode}:${favorite.chapter}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.favorites.push(favorite);
    else buckets.set(key, { firstIndex: index, favorites: [favorite] });
  });

  return [...buckets.entries()]
    .sort((left, right) => left[1].firstIndex - right[1].firstIndex)
    .flatMap(([bucketKey, bucket]) => {
      const sorted = [...bucket.favorites].sort((left, right) => left.verse - right.verse);
      const groups: BibleFavoriteDTO[][] = [];
      for (const favorite of sorted) {
        const current = groups[groups.length - 1];
        const previous = current?.[current.length - 1];
        if (previous && favorite.verse <= previous.verseLine.endVerse + 1) current.push(favorite);
        else groups.push([favorite]);
      }
      return groups.map((group) => {
        const reference = passageReference(group);
        const savedAt = group.reduce((latest, favorite) => favorite.savedAt > latest ? favorite.savedAt : latest, group[0].savedAt);
        const lookup: BibleLookupDTO = {
          reference,
          normalizedReference: reference,
          translation: "新标点和合本（简体）",
          sourceId: "cmn-cu89s",
          verses: group.map((favorite) => favorite.verseLine)
        };
        return {
          key: `${bucketKey}:${group[0].verse}-${group[group.length - 1].verseLine.endVerse}`,
          favoriteIds: group.map((favorite) => favorite.id),
          favorites: group,
          savedAt,
          lookup
        };
      });
    });
}
