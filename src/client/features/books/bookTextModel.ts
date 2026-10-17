/** UTF-16, whitespace collapsed, semantic block boundaries; independent of CSS. */
export { BOOK_TEXT_REVISION } from "@shared/bookLocator";
const BLOCKS = new Set(["P", "DIV", "LI", "BLOCKQUOTE", "DD", "DT", "H1", "H2", "H3", "H4", "H5", "H6", "TR", "PRE", "SECTION", "ARTICLE", "ASIDE", "FIGCAPTION"]);
const OMIT = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "SELECT", "BUTTON", "INPUT", "RT", "RP"]);
const DECORATIONS = "[data-book-note-overlay],[data-book-quote-highlight],[data-book-decoration]";
type Position = { part: number; offset: number };
type Run = { start: number; end: number; from: Position; to: Position; whitespace: boolean };

export function createBookTextModel(doc: Document) {
  const nodes: Text[] = [], chunks: string[] = [], runs: Run[] = [];
  let breakBefore = false, length = 0;
  const append = (value: string, from: Position, to: Position, whitespace: boolean) => {
    if (whitespace) {
      if (!length) return;
      if (runs.at(-1)?.whitespace) { runs.at(-1)!.to = to; return; }
      value = " ";
    }
    chunks.push(value); runs.push({ start: length, end: length + value.length, from, to, whitespace }); length += value.length;
  };
  const visit = (node: Node) => {
    if (node.nodeType === 3) {
      const text = node as Text;
      if (!text.data) return;
      const part = nodes.length; nodes.push(text);
      if (breakBefore && length) append(" ", runs.at(-1)!.to, { part, offset: 0 }, true);
      breakBefore = false;
      for (const match of text.data.matchAll(/\s+|[^\s]+/gu)) {
        const offset = match.index!, value = match[0];
        append(value, { part, offset }, { part, offset: offset + value.length }, /^\s/u.test(value));
      }
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element, tag = element.localName.toUpperCase();
    if (OMIT.has(tag) || element.matches(DECORATIONS)) return;
    const block = BLOCKS.has(tag);
    if (block || tag === "BR") breakBefore = true;
    for (const child of element.childNodes) visit(child);
    if (block) breakBefore = true;
  };
  if (doc.body) visit(doc.body);
  if (runs.at(-1)?.whitespace) { length--; runs.pop(); chunks.pop(); }
  const text = { text: chunks.join("") };
  // Safari's Segments.containing() disagrees at some CJK/emoji boundaries.
  // Iterate once and retain only multi-unit graphemes, rather than one entry per character.
  const complex: { start: number; end: number }[] = [];
  for (const segment of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text.text)) {
    if (segment.segment.length > 1) complex.push({ start: segment.index, end: segment.index + segment.segment.length });
  }
  const boundary = (offset: number) => {
    let low = 0, high = complex.length;
    while (low < high) { const mid = (low + high) >>> 1; if (complex[mid]!.start < offset) low = mid + 1; else high = mid; }
    return !low || offset >= complex[low - 1]!.end;
  };
  const valid = (start: number, end: number) => Number.isSafeInteger(start) && Number.isSafeInteger(end)
    && start >= 0 && end >= start && end <= length && boundary(start) && boundary(end);
  const position = (offset: number, end: boolean): Position | null => {
    if (!runs.length) return null;
    if (!end && offset === length) return runs.at(-1)!.to;
    const char = end ? offset - 1 : offset;
    let low = 0, high = runs.length;
    while (low < high) { const mid = (low + high) >>> 1; if (runs[mid]!.end <= char) low = mid + 1; else high = mid; }
    const run = runs[low];
    if (!run) return null;
    return run.whitespace ? end ? run.to : run.from : { part: run.from.part, offset: run.from.offset + offset - run.start };
  };
  const range = (start: number, end: number): Range | null => {
    if (!valid(start, end)) return null;
    const from = position(start, false), to = end === start ? from : position(end, true);
    if (!from || !to) return null;
    const result = doc.createRange();
    result.setStart(nodes[from.part]!, from.offset); result.setEnd(nodes[to.part]!, to.offset); return result;
  };
  const offsets = (selection: Range): { start: number; end: number } | null => {
    if (!doc.body?.contains(selection.startContainer) || !doc.body.contains(selection.endContainer)) return null;
    const edge = selection.cloneRange(); edge.collapse(true);
    const point = doc.createRange();
    const search = (ends: boolean, inclusive: boolean) => {
      let low = 0, high = length;
      while (low < high) {
        const mid = (low + high) >>> 1, pos = position(ends ? mid + 1 : mid, ends)!;
        point.setStart(nodes[pos.part]!, pos.offset); point.collapse(true);
        const comparison = point.compareBoundaryPoints(0, edge);
        if (comparison < 0 || inclusive && comparison === 0) low = mid + 1; else high = mid;
      }
      return low;
    };
    let start = search(true, true);
    edge.setStart(selection.endContainer, selection.endOffset); edge.collapse(true);
    let end = selection.collapsed ? start : search(false, false);
    // A synthetic block separator lies outside a selection ending at the block edge.
    const raw = selection.toString();
    if (!/^\s/u.test(raw)) while (start < end && text.text[start] === " ") start++;
    if (!/\s$/u.test(raw)) while (end > start && text.text[end - 1] === " ") end--;
    while (start > 0 && !boundary(start)) start--;
    while (end < length && !boundary(end)) end++;
    return valid(start, end) ? { start, end } : null;
  };
  const readText = (start: number, end: number) => valid(start, end) ? text.text.slice(start, end) : null;
  const rects = (start: number, end: number) => { const target = range(start, end); return target ? Array.from(target.getClientRects()) : null; };
  return { nodes, text, range, offsets, valid, readText, rects };
}
export type BookTextModel = ReturnType<typeof createBookTextModel>;

// LRU: four documents and one million UTF-16 units. One oversized current chapter
// may exceed the text budget, rather than rebuilding it on every native scroll.
const models = new Map<Document, BookTextModel>();
export function forgetBookTextModel(doc: Document) { models.delete(doc); }
export function bookTextModel(doc: Document): BookTextModel {
  const model = models.get(doc) ?? createBookTextModel(doc);
  models.delete(doc); models.set(doc, model);
  let total = [...models.values()].reduce((sum, entry) => sum + entry.text.text.length, 0);
  for (const [key, entry] of models) {
    if (models.size <= 4 && (total <= 1_000_000 || models.size === 1)) break;
    total -= entry.text.text.length; models.delete(key);
  }
  return model;
}

/** A sentence/ASR interval is relative to the selected source range, never a page. */
export function bookTextSubrange(model: BookTextModel, selection: { start: number; end: number }, start: number, end: number) {
  if (!model.valid(selection.start, selection.end) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
    || start < 0 || end <= start || end > selection.end - selection.start) return null;
  return model.range(selection.start + start, selection.start + end);
}
