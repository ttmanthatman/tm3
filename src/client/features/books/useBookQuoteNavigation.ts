import { onScopeDispose } from "vue";
import { sectionAtFraction } from "../../books/reader";
import { findBookQuoteRange } from "./bookNoteHighlights";
import { highlightBookQuote } from "./bookQuoteHighlight";
import type { BookLocation } from "./bookReading";

export function useBookQuoteNavigation(options: {
  sectionFractions: () => number[];
  navigateFraction: (fraction: number) => Promise<void>;
  navigateRange: (doc: Document, index: number, range: Range) => Promise<void>;
}) {
  const documents = new Map<number, Document>();
  let removeHighlight: (() => void) | undefined;
  let sequence = 0;
  const clear = () => { sequence++; removeHighlight?.(); removeHighlight = undefined; };
  const bind = (doc: Document, index: number) => { documents.set(index, doc); };
  async function highlight(location: BookLocation) {
    clear();
    if (!location.quote) return;
    const request = sequence;
    const { index, fraction } = sectionAtFraction(options.sectionFractions(), location.fraction);
    const doc = documents.get(index);
    if (!doc?.defaultView?.frameElement?.isConnected) return;
    const range = findBookQuoteRange(doc, location.quote, fraction);
    if (!range) return;
    await options.navigateRange(doc, index, range);
    if (request === sequence) removeHighlight = highlightBookQuote(doc, range);
  }
  async function jump(location: BookLocation) {
    clear();
    const request = sequence;
    await options.navigateFraction(location.fraction);
    if (request === sequence) await highlight(location);
  }
  function reset() { clear(); documents.clear(); }
  onScopeDispose(reset);
  return { bind, highlight, jump, clear, reset };
}
