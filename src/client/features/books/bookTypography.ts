import type { ReaderStyle } from "../../books/reader";

/** User typography wins even over author ID selectors/inline !important sizes.
 * Attribute changes preserve text nodes, source offsets and Foliate CFI paths. */
export function applyBookTypography(doc: Document, style: ReaderStyle): void {
  doc.documentElement.style.setProperty("font-size", `${16 * style.fontPct / 100}px`, "important");
  const prose = "body,p,li,blockquote,dd,dt,div,section,article,td,th";
  for (const element of doc.querySelectorAll<HTMLElement>(prose)) {
    if (element.closest("[data-book-note-overlay],[data-book-quote-highlight],[data-book-decoration]")) continue;
    element.style.setProperty("font-size", "1rem", "important");
    element.style.setProperty("line-height", String(style.spacing), "important");
  }
  for (const element of doc.querySelectorAll<HTMLElement>("p :is(span,a,em,strong,b,i),li :is(span,a,em,strong,b,i)")) {
    element.style.setProperty("font-size", "inherit", "important");
    element.style.setProperty("line-height", "inherit", "important");
  }
  for (const element of doc.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")) {
    const level = Number(element.localName.slice(1));
    element.style.setProperty("font-size", `${level === 1 ? 2 : level === 2 ? 1.5 : level === 3 ? 1.25 : 1.1}rem`, "important");
  }
}
