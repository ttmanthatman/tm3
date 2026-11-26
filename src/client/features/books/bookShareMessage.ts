import { parseBookReadingUrl, type BookReadingContext } from "./bookReading";

// Recognize both current shares and the original heading/location/link format.
export function parseBookShareMessage(content: string, origin: string): (BookReadingContext & { comment?: string }) | null {
  if (!content.includes("bookId") || !/^(摘录自|邀请你一起读)《/.test(content)) return null;
  const doc = new DOMParser().parseFromString(content, "text/html");
  const anchor = Array.from(doc.querySelectorAll("a[href]")).find((item) => parseBookReadingUrl(item.getAttribute("href") || "", origin));
  if (!anchor) return null;
  const location = parseBookReadingUrl(anchor.getAttribute("href") || "", origin)!;
  const linkText = anchor.textContent || "";
  // Older messages may append plain text or several paragraphs after the link.
  // Keep all of that outside the book quote, including after message sanitation.
  const tail = doc.createRange();
  tail.setStartAfter(anchor);
  tail.setEnd(doc.body, doc.body.childNodes.length);
  const comments = tail.extractContents();
  for (const br of comments.querySelectorAll("br")) br.replaceWith("\n");
  for (const paragraph of comments.querySelectorAll("p")) paragraph.append("\n");
  let comment = (comments.textContent || "").trim();
  anchor.remove();
  for (const br of doc.querySelectorAll("br")) br.replaceWith("\n");
  const lines = (doc.body.textContent || "").trim().split("\n");
  const heading = /^(摘录自|邀请你一起读)《(.+)》$/.exec(lines.shift() || "");
  if (!heading) return null;
  const current = /^打开书中的位置：(.*?)\s*(?:·\s*)?\d+%$/.exec(linkText);
  const legacy = current ? null : /^(.*?)\s*(?:·\s*)?\d+%$/.exec(lines[0] || "");
  const chapter = (current?.[1] ?? legacy?.[1] ?? "").replace(/\s*·\s*$/, "").trim();
  if (legacy) lines.shift();
  const body = heading[1] === "摘录自" ? lines.join("\n").trim() : "";
  let quote = body.replace(/^“|”$/g, "");
  // Legacy links carry the exact source text. Use that explicit boundary rather
  // than guessing whether a sentence or a quoted passage is the reader's note.
  if (location.quote && body.startsWith(`“${location.quote}”`)) {
    const inlineComment = body.slice(location.quote.length + 2).trim();
    if (inlineComment) {
      comment = [inlineComment, comment].filter(Boolean).join("\n");
      quote = location.quote;
    }
  }
  return { ...location, title: heading[2], chapter, quote, ...(comment ? { comment } : {}) };
}
