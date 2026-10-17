import { bookTextModel } from "./bookTextModel";

export type BookViewAnchor = { doc: Document; start: number; end: number; top: number };

/** Find actual visible source text; rectangles from hidden notes/decoration are ignored. */
export function captureBookViewAnchor(doc: Document, top: number, bottom: number): BookViewAnchor | null {
  const frame = doc.defaultView?.frameElement;
  if (!frame || !doc.body) return null;
  const frameTop = frame.getBoundingClientRect().top;
  const model = bookTextModel(doc);
  const probe = doc.createRange();
  for (const node of model.nodes) {
    probe.selectNodeContents(node);
    if (!Array.from(probe.getClientRects()).some(rect => rect.height > 0 && rect.width > 0 && frameTop + rect.bottom > top && frameTop + rect.top < bottom)) continue;
    // Find a visible character rather than the start of a very long paragraph.
    let low = 0, high = node.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      probe.setStart(node, mid); probe.setEnd(node, Math.min(node.length, mid + 1));
      const rect = probe.getBoundingClientRect();
      if (frameTop + rect.bottom <= top) low = mid + 1; else high = mid;
    }
    probe.setStart(node, low); probe.setEnd(node, Math.min(node.length, low + 1));
    const offsets = model.offsets(probe);
    if (!offsets) continue;
    const range = model.range(offsets.start, offsets.end);
    const rect = range?.getBoundingClientRect();
    if (rect && rect.height > 0) return { doc, ...offsets, top: frameTop + rect.top };
  }
  return null;
}

export function bookViewAnchorTop(anchor: BookViewAnchor): number | null {
  const frame = anchor.doc.defaultView?.frameElement;
  if (!frame?.isConnected) return null;
  const range = bookTextModel(anchor.doc).range(anchor.start, anchor.end);
  const rect = range?.getBoundingClientRect();
  return rect && rect.height > 0 ? frame.getBoundingClientRect().top + rect.top : null;
}
