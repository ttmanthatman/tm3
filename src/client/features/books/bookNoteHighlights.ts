import type { BookNoteDTO } from "../../../shared/bookNotes";

import { bookTextModel } from "./bookTextModel";
import { resolveBookLocator, type BookPublication } from "./bookLocator";
export { buildBookNoteText, type BookNoteText, type BookNoteTextPart } from "./bookText";
export function findBookNoteQuotes(text: string, quote: string): { start: number; end: number }[] {
  const needle = quote.replace(/\s+/gu, " ").trim();
  if (!needle) return [];
  const matches: { start: number; end: number }[] = [];
  for (let index = text.indexOf(needle); index >= 0; index = text.indexOf(needle, index + 1)) matches.push({ start: index, end: index + needle.length });
  return matches;
}

export function findBookNoteQuote(text: string, quote: string, fraction: number): { start: number; end: number } | null {
  const target = Math.max(0, Math.min(1, fraction)) * text.length;
  let best: { start: number; end: number } | null = null;
  let distance = Infinity;
  for (const match of findBookNoteQuotes(text, quote)) {
    const nextDistance = Math.abs((match.start + match.end) / 2 - target);
    if (nextDistance < distance) { best = match; distance = nextDistance; }
  }
  return best;
}

// Foliate restores a page with round(fraction * (textPages - 1)). A tiny
// within-page component distinguishes repeated quotes without crossing that boundary.
export function bookNotePageFraction(page: number, textPages: number, withinPage: number): number {
  const progress = Math.max(0, Math.min(1 - Number.EPSILON, withinPage));
  if (textPages <= 1) return progress;
  const index = Math.max(0, Math.min(textPages - 1, page));
  const offset = index === 0 ? progress : index === textPages - 1 ? progress - 1 : progress - .5;
  return Math.max(0, Math.min(1 - Number.EPSILON, (index + offset * .0001) / (textPages - 1)));
}

/** A local section fraction in the coordinate system used by the active renderer. */
export function bookNoteRangeFraction(doc: Document, range: Range): number | null {
  const view = doc.defaultView;
  if (!view || !doc.body) return null;
  const rect = Array.from(range.getClientRects()).find((candidate) => candidate.width > 0 && candidate.height > 0);
  if (!rect) return null;
  const root = doc.documentElement;
  const style = view.getComputedStyle(root);
  const rootRect = root.getBoundingClientRect();
  if (style.columnWidth !== "auto" && parseFloat(style.columnWidth) > 0) {
    const vertical = style.writingMode.startsWith("vertical");
    const rtl = style.direction === "rtl";
    const size = vertical ? rootRect.height : rootRect.width;
    if (size <= 0) return null;
    const contents = doc.createRange(); contents.selectNodeContents(doc.body);
    const contentRect = contents.getBoundingClientRect();
    const extent = vertical ? contentRect.bottom - rootRect.top
      : rtl ? rootRect.right - contentRect.left : contentRect.right - rootRect.left;
    const iframeExtent = vertical ? view.innerHeight : view.innerWidth;
    const textPages = Math.max(1, Math.ceil(extent / size), Math.round(iframeExtent / size));
    const offset = vertical ? rect.top - rootRect.top
      : rtl ? rootRect.right - rect.right : rect.left - rootRect.left;
    const withinPage = vertical ? (rootRect.right - (rect.left + rect.width / 2)) / Math.max(1, rootRect.width)
      : (rect.top + rect.height / 2 - rootRect.top) / Math.max(1, rootRect.height);
    return bookNotePageFraction(Math.floor(Math.max(0, offset) / size), textPages, withinPage);
  }
  // ContinuousBookReader restores the section's viewport center using its full height.
  const height = Math.max(root.scrollHeight, doc.body.scrollHeight, 1);
  return Math.max(0, Math.min(1 - Number.EPSILON, (rect.top + rect.height / 2 - rootRect.top) / height));
}

export function bookNoteInSection(fraction: number, start: number, end: number): boolean {
  return Number.isFinite(fraction) && end > start && fraction >= start && (fraction < end || end === 1 && fraction === 1);
}

type NoteHighlightOptions = {
  publication?: BookPublication | null;
  sectionHref?: string;
  cfiRange?: (cfi: string) => Range | null;
  startFraction: number;
  endFraction: number;
  onOpen: (note: BookNoteDTO) => void;
};
export type BookNoteHighlights = { refresh: () => void; destroy: () => void };
type HighlightWindow = Window & {
  CSS?: { highlights?: HighlightRegistry };
  Highlight?: new (...ranges: Range[]) => Highlight;
  ResizeObserver?: typeof ResizeObserver;
};
const activeHighlights = new WeakMap<Document, BookNoteHighlights>();
const HIGHLIGHT_NAME = "book-saved-notes";
const OVERLAY_ATTRIBUTE = "data-book-note-overlay";
const NOTEBOOK_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M3 7h5M3 12h5M3 17h5M11 8h6M11 12h6M11 16h4"/></svg>';

/** Resolve shared text without changing the EPUB's text nodes or page geometry. */
export function findBookQuoteRange(doc: Document, quote: string, fraction: number): Range | null {
  const view = doc.defaultView;
  if (!view || !doc.body) return null;
  const model = bookTextModel(doc), { text } = model;
  let closest: Range | null = null;
  let distance = Infinity;
  for (const match of findBookNoteQuotes(text.text, quote)) {
    const range = model.range(match.start, match.end);
    if (!range) continue;
    if (!Array.from(range.getClientRects()).some(rect => rect.width > 0 && rect.height > 0)) continue;
    const position = bookNoteRangeFraction(doc, range) ?? (match.start + match.end) / 2 / Math.max(1, text.text.length);
    const nextDistance = Math.abs(position - fraction);
    if (nextDistance < distance) { closest = range; distance = nextDistance; }
  }
  return closest;
}

/** Draw private note marks without wrapping/splitting EPUB text or changing page flow. */
export function renderBookNoteHighlights(doc: Document, notes: readonly BookNoteDTO[], options: NoteHighlightOptions): BookNoteHighlights {
  activeHighlights.get(doc)?.destroy();
  const view = doc.defaultView as HighlightWindow | null;
  if (!view || !doc.body) return { refresh() {}, destroy() {} };
  const sectionNotes = notes.filter((note) => note.locator ? note.locator.sectionHref === options.sectionHref : bookNoteInSection(note.fraction, options.startFraction, options.endFraction));
  if (!sectionNotes.length) return { refresh() {}, destroy() {} };
  const model = bookTextModel(doc), { text } = model;
  const marked: { note: BookNoteDTO; candidates: { range: Range; textFraction: number }[]; range: Range }[] = [];
  const seen = new Set<string>();
  for (const note of sectionNotes) {
    if (seen.has(note.id)) continue;
    seen.add(note.id);
    if (note.locator) {
      if (!options.publication || !options.sectionHref) continue;
      const resolved = resolveBookLocator(options.publication, options.sectionHref, doc, note.locator, note.locator.cfi ? options.cfiRange?.(note.locator.cfi) : null);
      if (resolved.range) marked.push({ note, candidates: [{ range: resolved.range, textFraction: 0 }], range: resolved.range });
      continue;
    }
    const candidates = findBookNoteQuotes(text.text, note.quote).flatMap((match) => {
      const range = model.range(match.start, match.end);
      return range ? [{ range, textFraction: (match.start + match.end) / 2 / Math.max(1, text.text.length) }] : [];
    });
    if (!candidates.length) continue;
    marked.push({ note, candidates, range: candidates[0]!.range });
  }
  if (!marked.length) return { refresh() {}, destroy() {} };

  const native = !!view.CSS?.highlights && !!view.Highlight;
  const stylesheet = doc.createElement("style");
  stylesheet.setAttribute("data-book-note-style", "");
  stylesheet.textContent = `
    ::highlight(${HIGHLIGHT_NAME}) { background-color: rgba(229, 172, 58, .32); }
    [${OVERLAY_ATTRIBUTE}] { all: initial !important; position: fixed !important; inset: 0 auto auto 0 !important; width: 0 !important; height: 0 !important; z-index: 10 !important; pointer-events: none !important; }
    [${OVERLAY_ATTRIBUTE}] > span { all: initial !important; position: absolute !important; background: rgba(229, 172, 58, .32) !important; border-radius: 2px !important; pointer-events: none !important; }
    [${OVERLAY_ATTRIBUTE}] > button { all: initial !important; position: absolute !important; z-index: 1 !important; display: flex !important; align-items: center !important; justify-content: center !important; width: 24px !important; height: 24px !important; padding: 0 !important; margin: 0 !important; border: 1px solid #b98b45 !important; border-radius: 5px !important; background: #f5dfac !important; color: #60421f !important; cursor: pointer !important; pointer-events: auto !important; }
    [${OVERLAY_ATTRIBUTE}] > button:focus-visible { outline: 2px solid #1266b0 !important; outline-offset: 2px !important; }
    [${OVERLAY_ATTRIBUTE}] svg { display: block !important; width: 16px !important; height: 16px !important; fill: none !important; stroke: currentColor !important; }
  `;
  doc.head.append(stylesheet);
  // Outside body: Foliate measures/selects body contents to calculate page count.
  const overlay = doc.createElement("div");
  overlay.setAttribute(OVERLAY_ATTRIBUTE, "");
  doc.documentElement.append(overlay);
  const buttons = new Map<string, HTMLButtonElement>();
  let destroyed = false;
  let frame: number | null = null;
  function draw() {
    if (destroyed || !view) return;
    for (const mark of overlay.querySelectorAll("span")) mark.remove();
    const iconPositions = new Map<string, number>();
    for (const mark of marked) {
      const localFraction = (mark.note.fraction - options.startFraction) / (options.endFraction - options.startFraction);
      let distance = Infinity;
      for (const candidate of mark.candidates) {
        const position = bookNoteRangeFraction(doc, candidate.range) ?? candidate.textFraction;
        const nextDistance = Math.abs(position - localFraction);
        if (nextDistance < distance) { mark.range = candidate.range; distance = nextDistance; }
      }
    }
    if (native) view.CSS!.highlights!.set(HIGHLIGHT_NAME, new view.Highlight!(...marked.map(({ range }) => range)));
    for (const { note, range } of marked) {
      const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
      if (!native) {
        for (const rect of rects) {
          const mark = doc.createElement("span");
          mark.style.setProperty("left", `${rect.left}px`, "important");
          mark.style.setProperty("top", `${rect.top}px`, "important");
          mark.style.setProperty("width", `${rect.width}px`, "important");
          mark.style.setProperty("height", `${rect.height}px`, "important");
          overlay.append(mark);
        }
      }
      const rect = rects[rects.length - 1];
      if (!rect) { buttons.get(note.id)?.style.setProperty("display", "none", "important"); continue; }
      const key = `${Math.round(rect.right)}:${Math.round(rect.top)}`;
      const rank = iconPositions.get(key) ?? 0;
      iconPositions.set(key, rank + 1);
      let button = buttons.get(note.id);
      if (!button) {
        button = doc.createElement("button");
        button.type = "button";
        button.dataset.bookNoteId = note.id;
        button.setAttribute("aria-label", `查看笔记：${note.quote.slice(0, 40)}`);
        button.title = "查看笔记";
        button.innerHTML = NOTEBOOK_SVG;
        button.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); options.onOpen(note); });
        buttons.set(note.id, button);
        overlay.append(button);
      }
      button.style.setProperty("display", "flex", "important");
      button.style.setProperty("left", `${Math.max(0, Math.min(rect.right + 2, view.innerWidth - 24))}px`, "important");
      button.style.setProperty("top", `${rect.top + Math.max(0, (rect.height - 24) / 2) + rank * 24}px`, "important");
    }
  }
  const refresh = () => {
    if (destroyed || frame !== null) return;
    frame = view.requestAnimationFrame(() => { frame = null; draw(); });
  };
  const resizeObserver = view.ResizeObserver ? new view.ResizeObserver(refresh) : null;
  resizeObserver?.observe(doc.body);
  view.addEventListener("resize", refresh);
  view.addEventListener("scroll", refresh);
  doc.addEventListener("load", refresh, true);
  void doc.fonts?.ready.then(refresh);
  const handle: BookNoteHighlights = {
    refresh,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (frame !== null) view.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      view.removeEventListener("resize", refresh);
      view.removeEventListener("scroll", refresh);
      doc.removeEventListener("load", refresh, true);
      if (native) view.CSS!.highlights!.delete(HIGHLIGHT_NAME);
      overlay.remove(); stylesheet.remove();
      if (activeHighlights.get(doc) === handle) activeHighlights.delete(doc);
    }
  };
  activeHighlights.set(doc, handle);
  draw();
  return handle;
}
