import { onScopeDispose, ref } from "vue";
import type { BookNoteDTO } from "@shared/bookNotes";
import { bookNotesClient } from "./bookNotesClient";
import { bookNoteRangeFraction, renderBookNoteHighlights, type BookNoteHighlights } from "./bookNoteHighlights";
import type { BookReadingContext } from "./bookReading";

export function useBookNoteHighlights(options: {
  bookId: () => number | undefined;
  accountId: () => number | undefined;
  sectionFractions: () => number[];
  chapter: (index: number) => string;
  openNote: (note: BookNoteDTO) => void;
}) {
  const error = ref("");
  const documents = new Map<Document, { index: number; marks: BookNoteHighlights | null }>();
  let notes: BookNoteDTO[] = [];
  let sequence = 0;
  function render(doc: Document, entry: { index: number; marks: BookNoteHighlights | null }) {
    entry.marks?.destroy();
    const starts = options.sectionFractions();
    entry.marks = renderBookNoteHighlights(doc, notes, {
      startFraction: starts[entry.index] ?? 0,
      endFraction: starts[entry.index + 1] ?? 1,
      onOpen: options.openNote
    });
  }
  function bind(doc: Document, index: number) {
    for (const [previous, entry] of documents) {
      if (previous !== doc && !previous.defaultView?.frameElement?.isConnected) {
        entry.marks?.destroy(); documents.delete(previous);
      }
    }
    documents.get(doc)?.marks?.destroy();
    const entry = { index, marks: null as BookNoteHighlights | null };
    documents.set(doc, entry); render(doc, entry);
  }
  async function reload(bookId = options.bookId()) {
    if (!bookId || bookId !== options.bookId() || !options.accountId()) return;
    const request = ++sequence, accountId = options.accountId();
    error.value = "";
    try {
      const result = await bookNotesClient.list(bookId);
      if (request !== sequence || options.bookId() !== bookId || options.accountId() !== accountId) return;
      notes = result.notes;
      for (const [doc, entry] of documents) render(doc, entry);
    } catch (cause) {
      if (request === sequence) error.value = cause instanceof Error ? cause.message : "笔记高亮读取失败";
    }
  }
  function refresh() { for (const entry of documents.values()) entry.marks?.refresh(); }
  function reset() {
    sequence++;
    for (const entry of documents.values()) entry.marks?.destroy();
    documents.clear(); notes = []; error.value = "";
  }
  function selectionContext(doc: Document, context: BookReadingContext): BookReadingContext {
    const entry = documents.get(doc), selected = doc.getSelection();
    if (!entry || !selected?.rangeCount || !doc.body) return context;
    const starts = options.sectionFractions();
    const start = starts[entry.index] ?? 0, end = starts[entry.index + 1] ?? 1;
    const range = selected.getRangeAt(0);
    if (!doc.body.contains(range.startContainer)) return context;
    const localFraction = bookNoteRangeFraction(doc, range);
    if (localFraction === null) return context;
    const fraction = Math.min(end - Number.EPSILON, start + (end - start) * localFraction);
    return { ...context, fraction, chapter: options.chapter(entry.index) || context.chapter };
  }
  onScopeDispose(reset);
  return { error, bind, reload, refresh, reset, selectionContext };
}
