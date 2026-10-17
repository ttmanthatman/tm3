import { forgetBookTextModel } from "./bookTextModel";
import type { EpubBook } from "../../books/reader";
import { bookRangeCfi } from "./bookCfi";
import { createBookLocator, normalizeBookSectionHref, type BookLocatorV1, type BookPublication } from "./bookLocator";

/** Session addresses are useful for reflow but cannot pretend to be permanent file identities. */
export function createBookReaderLocations(book: () => EpubBook | null, bookId: () => number | undefined) {
  const documents = new Map<Document, number>();
  let publication: BookPublication | null = null;
  const sectionHref = (index: number) => normalizeBookSectionHref(book()?.sections[index]?.id ?? `section-${index}.xhtml`);
  return {
    publication: () => publication,
    begin(preserved?: BookLocatorV1, publicationRevision: string | null = null) {
      const id = bookId();
      publication = id ? { bookId: id, publicationRevision, ...(!publicationRevision ? { sessionId: preserved?.bookId === id ? preserved.sessionId : crypto.randomUUID() } : {}) } : null;
    },
    sectionHref,
    sectionIndex: (href: string) => book()?.sections.findIndex((_, index) => sectionHref(index) === href) ?? -1,
    bind(doc: Document, index: number) {
      for (const previous of documents.keys()) if (previous !== doc && !previous.defaultView?.frameElement?.isConnected) { documents.delete(previous); forgetBookTextModel(previous); }
      documents.set(doc, index);
    },
    unbind(doc: Document) { documents.delete(doc); forgetBookTextModel(doc); },
    reset() { for (const doc of documents.keys()) forgetBookTextModel(doc); documents.clear(); },
    capture(doc: Document, range: Range, fraction: number): BookLocatorV1 | null {
      const index = documents.get(doc);
      return publication && index !== undefined ? createBookLocator(publication, sectionHref(index), doc, range,
        { sectionIndex: index, fraction, cfi: bookRangeCfi(book()?.sections[index]?.cfi, range) }) : null;
    },
    cfiRange(cfi: string, doc: Document): Range | null {
      try {
        const resolved = book()?.resolveCFI?.(cfi);
        return resolved && resolved.index === documents.get(doc) ? resolved.anchor(doc) : null;
      } catch { return null; /* Malformed/obsolete CFI is recovered only by verified source text. */ }
    }
  };
}
