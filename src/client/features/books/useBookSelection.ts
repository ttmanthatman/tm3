import { onScopeDispose, ref } from "vue";
import type { BookReadingContext } from "./bookReading";

export function useBookSelection(context: () => BookReadingContext | null) {
  const selection = ref<BookReadingContext | null>(null);
  let selectedDocument: Document | null = null;
  let controller = new AbortController();
  function bind(doc: Document) {
    const update = () => {
      const quote = doc.getSelection()?.toString().trim() || "";
      const source = context();
      if (quote && source) { selectedDocument = doc; selection.value = { ...source, quote }; }
      else if (selectedDocument === doc) { selectedDocument = null; selection.value = null; }
    };
    doc.addEventListener("selectionchange", update, { signal: controller.signal });
    doc.addEventListener("pointerup", update, { signal: controller.signal });
    doc.addEventListener("keyup", update, { signal: controller.signal });
  }
  function clear() { selectedDocument?.getSelection()?.removeAllRanges(); selectedDocument = null; selection.value = null; }
  function reset() { clear(); controller.abort(); controller = new AbortController(); }
  onScopeDispose(() => { clear(); controller.abort(); });
  return { selection, bind, clear, reset };
}
