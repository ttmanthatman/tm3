import type { MessageSearchCursorDTO } from "@shared/types";

export function normalizeMessageSearchQuery(value: string) {
  return value.trim();
}

export function messageSearchSnippet(value: string, query: string, maxLength = 150) {
  if (value.length <= maxLength) return { text: value, startsEarlier: false, endsLater: false };
  const matchAt = value.toLowerCase().indexOf(query.toLowerCase());
  const start = Math.max(0, (matchAt < 0 ? 0 : matchAt) - Math.floor(maxLength / 3));
  const end = Math.min(value.length, start + maxLength);
  return {
    text: value.slice(start, end),
    startsEarlier: start > 0,
    endsLater: end < value.length
  };
}

export function highlightMessageSearchText(value: string, query: string) {
  const normalizedQuery = query.toLowerCase();
  if (!normalizedQuery) return [{ text: value, match: false }];
  const normalizedValue = value.toLowerCase();
  const segments: Array<{ text: string; match: boolean }> = [];
  let cursor = 0;
  let foundAt = normalizedValue.indexOf(normalizedQuery, cursor);
  while (foundAt >= 0) {
    if (foundAt > cursor) segments.push({ text: value.slice(cursor, foundAt), match: false });
    segments.push({ text: value.slice(foundAt, foundAt + query.length), match: true });
    cursor = foundAt + query.length;
    foundAt = normalizedValue.indexOf(normalizedQuery, cursor);
  }
  if (cursor < value.length || !segments.length) segments.push({ text: value.slice(cursor), match: false });
  return segments;
}

export function messageSearchPageUrl(query: string, cursor: MessageSearchCursorDTO | null) {
  const params = new URLSearchParams({ query });
  if (cursor) {
    params.set("beforeId", String(cursor.id));
    params.set("beforeCreatedAt", cursor.createdAt);
  }
  return `/api/messages/search?${params.toString()}`;
}
