import type { BibleLookupDTO } from "@shared/types";
import { escapeHtmlText } from "../messages/messageRendering";
import { extractBibleReferenceMatches } from "../../bibleReferences";

export type BiblePassageShare = { reference: string; text: string; translation: string };

export function biblePassageShareContent(lookup: BibleLookupDTO, includeTranslation = false): string {
  const body = lookup.verses.map((verse) => verse.text).join("");
  return `${escapeHtmlText(lookup.normalizedReference)}<br>“${escapeHtmlText(body)}”${includeTranslation ? `<br>——${escapeHtmlText(lookup.translation)}` : ""}`;
}

// Match only the complete passage format produced by the Bible reader. Ordinary
// messages that merely mention a reference must keep their rich-text behavior.
export function parseBiblePassageShare(content: string): BiblePassageShare | null {
  if (!/<br\s*\/?\s*>/i.test(content)) return null;
  const doc = new DOMParser().parseFromString(content, "text/html");
  if (doc.body.querySelector(":not(br)")) return null;
  for (const br of doc.querySelectorAll("br")) br.replaceWith("\n");
  const match = /^([^\n]+)\n“([\s\S]+)”(?:\n——([^\n]+))?$/.exec((doc.body.textContent || "").trim());
  if (!match) return null;
  const reference = match[1].trim();
  const references = extractBibleReferenceMatches(reference);
  if (references.length !== 1 || references[0].start !== 0 || references[0].end !== reference.length) return null;
  return { reference, text: match[2], translation: match[3]?.trim() || "" };
}

export function readingNoteComment(content: string, title: string): string {
  const doc = new DOMParser().parseFromString(content, "text/html");
  for (const br of doc.querySelectorAll("br")) br.replaceWith("\n");
  const text = (doc.body.textContent || "").trim();
  return text === `阅读笔记 · 《${title}》` ? "" : text;
}
