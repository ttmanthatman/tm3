type QuoteWindow = Window & { CSS?: { highlights?: HighlightRegistry }; Highlight?: new (...ranges: Range[]) => Highlight };

/** A separate, temporary mark: it never edits EPUB text or the reader's private notes. */
export function highlightBookQuote(doc: Document, range: Range): () => void {
  const view = doc.defaultView as QuoteWindow | null;
  if (!view) return () => {};
  const name = "book-shared-quote";
  const native = !!view.CSS?.highlights && !!view.Highlight;
  const style = doc.createElement("style");
  style.textContent = `::highlight(${name}) { background: #ffcf54; color: #302410; }
    [data-book-quote-highlight] { all: initial !important; position: fixed !important; inset: 0 auto auto 0 !important; width: 0 !important; height: 0 !important; pointer-events: none !important; z-index: 9 !important; }
    [data-book-quote-highlight] > span { all: initial !important; position: absolute !important; background: #ffc83d88 !important; border-radius: 2px !important; pointer-events: none !important; }`;
  doc.head.append(style);
  const overlay = doc.createElement("div");
  overlay.setAttribute("data-book-quote-highlight", "");
  overlay.setAttribute("aria-hidden", "true");
  doc.documentElement.append(overlay);
  let frame = 0;
  let destroyed = false;
  const draw = () => {
    overlay.replaceChildren();
    if (native) { view.CSS!.highlights!.set(name, new view.Highlight!(range)); return; }
    for (const rect of range.getClientRects()) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      const mark = doc.createElement("span");
      for (const [key, value] of Object.entries({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })) mark.style.setProperty(key, `${value}px`, "important");
      overlay.append(mark);
    }
  };
  const refresh = () => {
    if (destroyed || frame) return;
    frame = view.requestAnimationFrame(() => { frame = 0; draw(); });
  };
  const observer = new ResizeObserver(refresh);
  observer.observe(doc.documentElement);
  if (doc.body) observer.observe(doc.body);
  view.addEventListener("resize", refresh);
  view.addEventListener("scroll", refresh);
  doc.addEventListener("load", refresh, true);
  void doc.fonts?.ready.then(refresh);
  draw();
  return () => {
    destroyed = true;
    if (frame) view.cancelAnimationFrame(frame);
    observer.disconnect();
    view.removeEventListener("resize", refresh);
    view.removeEventListener("scroll", refresh);
    doc.removeEventListener("load", refresh, true);
    if (native) view.CSS!.highlights!.delete(name);
    overlay.remove(); style.remove();
  };
}
