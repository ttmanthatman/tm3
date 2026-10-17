import { onScopeDispose, ref } from "vue";
import type { BookReadingContext } from "./bookReading";

export function useBookSelection(context: (doc: Document) => BookReadingContext | null) {
  const selection = ref<BookReadingContext | null>(null);
  let selectedDocument: Document | null = null;
  const controllers = new Map<Document, AbortController>();
  function bind(doc: Document) {
    for (const previous of controllers.keys()) if (previous !== doc && !previous.defaultView?.frameElement?.isConnected) unbind(previous);
    unbind(doc);
    const controller = new AbortController();
    controllers.set(doc, controller);
    const update = () => {
      const quote = doc.getSelection()?.toString().trim() || "";
      const source = context(doc);
      if (quote && source) { selectedDocument = doc; selection.value = { ...source, quote }; }
      else if (selectedDocument === doc) { selectedDocument = null; selection.value = null; }
    };
    doc.addEventListener("selectionchange", update, { signal: controller.signal });
    doc.addEventListener("pointerup", update, { signal: controller.signal });
    doc.addEventListener("keyup", update, { signal: controller.signal });
  }
  function clear() { selectedDocument?.getSelection()?.removeAllRanges(); selectedDocument = null; selection.value = null; }
  function unbind(doc: Document) {
    controllers.get(doc)?.abort(); controllers.delete(doc);
    if (selectedDocument === doc) clear();
  }
  function reset() { clear(); for (const controller of controllers.values()) controller.abort(); controllers.clear(); }
  onScopeDispose(reset);
  return { selection, bind, unbind, clear, reset };
}
