import { parseBookReadingUrl, type BookReadingContext } from "./bookReading";

// Recognize both current shares and the original heading/location/link format.
export function parseBookShareMessage(content: string, origin: string): BookReadingContext | null {
  if (!content.includes("bookId") || !/^(摘录自|邀请你一起读)《/.test(content)) return null;
  const doc = new DOMParser().parseFromString(content, "text/html");
  const anchor = Array.from(doc.querySelectorAll("a[href]")).find((item) => parseBookReadingUrl(item.getAttribute("href") || "", origin));
  if (!anchor) return null;
  const location = parseBookReadingUrl(anchor.getAttribute("href") || "", origin)!;
  const linkText = anchor.textContent || "";
  anchor.remove();
  for (const br of doc.querySelectorAll("br")) br.replaceWith("\n");
  const lines = (doc.body.textContent || "").trim().split("\n");
  const heading = /^(摘录自|邀请你一起读)《(.+)》$/.exec(lines.shift() || "");
  if (!heading) return null;
  const current = /^打开书中的位置：(.*?)\s*(?:·\s*)?\d+%$/.exec(linkText);
  const legacy = current ? null : /^(.*?)\s*(?:·\s*)?\d+%$/.exec(lines[0] || "");
  const chapter = (current?.[1] ?? legacy?.[1] ?? "").replace(/\s*·\s*$/, "").trim();
  if (legacy) lines.shift();
  const quote = heading[1] === "摘录自" ? lines.join("\n").trim().replace(/^“|”$/g, "") : "";
  return { ...location, title: heading[2], chapter, quote };
}
