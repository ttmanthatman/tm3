import { onScopeDispose, ref } from "vue";
import { sectionAtFraction } from "../../books/reader";
import { findBookQuoteRange } from "./bookNoteHighlights";
import { highlightBookQuote } from "./bookQuoteHighlight";
import { resolveBookLocator, type BookPublication, type BookLocatorStatus } from "./bookLocator";
import type { BookLocation } from "./bookReading";

export function useBookQuoteNavigation(options: {
  sectionFractions: () => number[];
  publication?: () => BookPublication | null;
  sectionHref?: (index: number) => string;
  sectionIndex?: (href: string) => number;
  cfiRange?: (cfi: string, doc: Document) => Range | null;
  navigateFraction: (fraction: number) => Promise<void>;
  navigateRange: (doc: Document, index: number, range: Range) => Promise<void>;
}) {
  const error = ref("");
  const currentLocation = ref<BookLocation | null>(null);
  const status = ref<BookLocatorStatus | null>(null);
  const documents = new Map<number, Document>();
  let removeHighlight: (() => void) | undefined;
  let sequence = 0;
  const clear = () => { sequence++; error.value = ""; status.value = null; currentLocation.value = null; removeHighlight?.(); removeHighlight = undefined; };
  const bind = (doc: Document, index: number) => {
    for (const [key, previous] of documents) if (!previous.defaultView?.frameElement?.isConnected) documents.delete(key);
    documents.set(index, doc);
  };
  const unbind = (doc: Document) => { for (const [index, bound] of documents) if (bound === doc) documents.delete(index); };
  async function highlight(location: BookLocation) {
    clear();
    if (!location.quote && !location.locator) { status.value = "approximate"; return; }
    const request = sequence;
    const target = sectionAtFraction(options.sectionFractions(), location.fraction);
    const index = location.locator && options.sectionIndex ? options.sectionIndex(location.locator.sectionHref) : target.index;
    const doc = documents.get(index);
    if (!doc?.defaultView?.frameElement?.isConnected) { status.value = "not-found"; return; }
    let range: Range | null = null;
    if (location.locator && options.publication && options.sectionHref) {
      const publication = options.publication();
      if (!publication) { status.value = "revision-mismatch"; return; }
      const cfiRange = location.locator.cfi ? options.cfiRange?.(location.locator.cfi, doc) : null;
      const resolved = resolveBookLocator(publication, options.sectionHref(index), doc, location.locator, cfiRange);
      status.value = resolved.status; range = resolved.range ?? null;
    } else {
      range = findBookQuoteRange(doc, location.quote ?? "", target.fraction);
      // Legacy percentage/quote data has no verifiable identity, even when text matches.
      status.value = range ? "approximate" : "not-found";
    }
    if (!range || !Array.from(range.getClientRects()).some(rect => rect.width > 0 && rect.height > 0)) {
      if (range) status.value = "not-found";
      return;
    }
    await options.navigateRange(doc, index, range);
    if (request === sequence) { removeHighlight = highlightBookQuote(doc, range); if (location.locator) currentLocation.value = location; }
  }
  async function jump(location: BookLocation) {
    clear();
    const request = sequence;
    let fraction = location.fraction;
    if (location.locator && options.sectionIndex) {
      const index = options.sectionIndex(location.locator.sectionHref);
      if (index < 0) { status.value = "not-found"; return; }
      const starts = options.sectionFractions();
      fraction = (starts[index]! + starts[index + 1]!) / 2;
    }
    try {
      await options.navigateFraction(fraction);
      if (request === sequence) await highlight(location);
    } catch (cause) {
      status.value = "not-found";
      error.value = cause instanceof Error ? cause.message : "原文位置加载失败，请重试";
    }
  }
  function reset() { clear(); documents.clear(); }
  onScopeDispose(reset);
  return { error, status, currentLocation, releaseLocation: () => { currentLocation.value = null; }, bind, unbind, highlight, jump, clear, reset };
}
