import { BOOK_TEXT_REVISION, bookTextModel, type BookTextModel } from "./bookTextModel";
import type { BookPublication, BookLocatorV1 } from "@shared/bookLocator";
export type { BookPublication, BookLocatorV1 } from "@shared/bookLocator";
export type BookLocatorStatus = "exact" | "recovered" | "approximate" | "ambiguous" | "revision-mismatch" | "not-found";
export type BookLocatorResult = { status: BookLocatorStatus; range?: Range; candidates?: number[] };

export function normalizeBookSectionHref(href: string): string {
  const url = new URL(href, "https://epub.invalid/");
  if (url.origin !== "https://epub.invalid") throw new Error("章节地址必须属于原书");
  return url.pathname.replace(/^\//, "");
}

export function createBookLocator(publication: BookPublication, sectionHref: string, doc: Document, range: Range, hints: { sectionIndex?: number; cfi?: string; fraction?: number } = {}): BookLocatorV1 | null {
  const model = bookTextModel(doc), offsets = model.offsets(range);
  if (!offsets) return null;
  const { start, end } = offsets, text = model.text.text;
  const clip = (from: number, to: number) => {
    while (from < to && !model.valid(from, from)) from++;
    while (to > from && !model.valid(to, to)) to--;
    return text.slice(from, to);
  };
  return { ...publication, ...hints, version: 1, textRevision: BOOK_TEXT_REVISION, sectionHref: normalizeBookSectionHref(sectionHref), start, end,
    quote: { exact: clip(start, Math.min(end, start + 256)), prefix: clip(Math.max(0, start - 48), start),
      suffix: clip(end, Math.min(text.length, end + 48)), length: end - start, ...(end - start > 256 ? { tail: clip(end - 128, end) } : {}) } };
}

function quoteMatches(model: BookTextModel, locator: BookLocatorV1, start: number, end: number) {
  const { text } = model.text, q = locator.quote;
  return model.valid(start, end) && end - start === q.length && q.exact.length <= q.length
    && text.slice(start, start + q.exact.length) === q.exact
    && (!q.tail || text.slice(end - q.tail.length, end) === q.tail);
}

function contextMatches(model: BookTextModel, locator: BookLocatorV1, start: number, end: number) {
  const { text } = model.text, q = locator.quote;
  return (!q.prefix || text.slice(Math.max(0, start - q.prefix.length), start) === q.prefix)
    && (!q.suffix || text.slice(end, end + q.suffix.length) === q.suffix);
}

/** Never silently attach an address to another file, algorithm or unverified session. */
export function resolveBookLocator(publication: BookPublication, sectionHref: string, doc: Document, locator: BookLocatorV1, cfiRange?: Range | null): BookLocatorResult {
  if (locator.version !== 1 || locator.textRevision !== BOOK_TEXT_REVISION || locator.bookId !== publication.bookId
    || locator.publicationRevision !== publication.publicationRevision
    || !publication.publicationRevision && (!publication.sessionId || locator.sessionId !== publication.sessionId)) return { status: "revision-mismatch" };
  if (normalizeBookSectionHref(sectionHref) !== locator.sectionHref) return { status: "not-found" };
  const model = bookTextModel(doc);
  if (quoteMatches(model, locator, locator.start, locator.end) && contextMatches(model, locator, locator.start, locator.end)) return { status: "exact", range: model.range(locator.start, locator.end) ?? undefined };
  if (cfiRange) {
    const offsets = model.offsets(cfiRange);
    if (offsets && quoteMatches(model, locator, offsets.start, offsets.end) && contextMatches(model, locator, offsets.start, offsets.end)) return { status: "recovered", range: cfiRange };
  }
  const q = locator.quote;
  if (!q.exact) return { status: "not-found" };
  const candidates: number[] = [];
  const text = model.text.text;
  for (let start = text.indexOf(q.exact); start >= 0; start = text.indexOf(q.exact, start + 1)) {
    const end = start + q.length;
    if (quoteMatches(model, locator, start, end) && (!q.prefix || text.slice(Math.max(0, start - q.prefix.length), start) === q.prefix)
      && (!q.suffix || text.slice(end, end + q.suffix.length) === q.suffix)) candidates.push(start);
    if (candidates.length === 20) break;
  }
  if (candidates.length > 1) return { status: "ambiguous", candidates };
  const start = candidates[0];
  return start === undefined ? { status: "not-found" } : { status: "recovered", range: model.range(start, start + q.length) ?? undefined };
}
