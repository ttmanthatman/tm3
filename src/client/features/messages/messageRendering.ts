import { marked } from "marked";
import DOMPurify from "dompurify";
import type { LinkPreviewDTO, MessageDTO, MusicMentionPayload } from "@shared/types";
import { memoizeMessage } from "../../memoize";
import { extractBibleReferenceMatches, extractBibleReferencesFromText } from "../../bibleReferences";
import { chainPayload } from "../chain/chain";

// linkifyMessageHtml stays in App.vue (pinned by responsiveLayout.test.ts text
// assertions); pure helpers that need linkification receive it as a parameter.
export type LinkifyMessageHtml = (html: string) => string;

export function trimUrlPunctuation(value: string) {
  let url = value;
  let suffix = "";
  while (/[，。！？、,.!?:;；：）)\]}》】”’"'`]+$/.test(url)) {
    suffix = `${url.slice(-1)}${suffix}`;
    url = url.slice(0, -1);
  }
  return { url, suffix };
}

export function normalizeMessageUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

export function extractMessageUrls(html: string) {
  const root = document.createElement("div");
  root.innerHTML = html || "";
  const urls: string[] = [];
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const url = normalizeMessageUrl(anchor.href);
    if (url) urls.push(url);
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = walker.currentNode.textContent || "";
    for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
      const { url } = trimUrlPunctuation(match[0]);
      const normalized = normalizeMessageUrl(url);
      if (normalized) urls.push(normalized);
    }
  }
  return [...new Set(urls)];
}

export function plainTextFromHtml(value: string) {
  const el = document.createElement("div");
  el.innerHTML = value;
  return (el.textContent || el.innerText || "").replace(/\s+/g, " ").trim();
}

// 剥离 Markdown 语法标记，用于引用预览等纯文本场景，和服务端 stripMarkdownSyntax 保持一致。
export function stripMarkdownSyntax(value: string) {
  return String(value || "")
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/^```[^\n]*\n?/gm, "").replace(/```$/g, ""))
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/^\s*(\d+)[.、)]\s+/gm, "$1. ")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*[-*_]{3,}\s*$/gm, "—")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1$2")
    .replace(/(^|[^_])_([^_]+)_/g, "$1$2")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function replyPreviewText(message: MessageDTO) {
  const text = stripMarkdownSyntax(plainTextFromHtml(message.content || ""));
  return text.slice(0, 140);
}

export function escapeHtmlText(text: string) {
  const element = document.createElement("span");
  element.textContent = text;
  return element.innerHTML.replace(/\n/g, "<br />");
}

export function wrapInlineHtml(html: string, tags: string[]) {
  return tags.reduceRight((value, tag) => `<${tag}>${value}</${tag}>`, html);
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function hostFromUrl(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function previewSiteName(preview?: LinkPreviewDTO | null) {
  return preview ? preview.siteName || hostFromUrl(preview.url) : "";
}

export const AI_ASSISTANT_USERNAMES = new Set(["why_assistant", "ai_slmm"]);

export function isAiAssistantMessage(message: MessageDTO) {
  return message.sender?.kind === "virtual" && AI_ASSISTANT_USERNAMES.has(message.sender?.username || "");
}

export function messagePayloadRecord(message: MessageDTO) {
  return message.payload && typeof message.payload === "object" && !Array.isArray(message.payload) ? (message.payload as Record<string, unknown>) : {};
}

export function musicMentionPayload(message: MessageDTO): MusicMentionPayload | null {
  const payload = messagePayloadRecord(message);
  const musicTrackId = Number(payload.musicTrackId);
  const musicTrackTitle = typeof payload.musicTrackTitle === "string" ? payload.musicTrackTitle.trim() : "";
  return Number.isInteger(musicTrackId) && musicTrackId > 0 ? { musicTrackId, musicTrackTitle: musicTrackTitle || "歌曲" } : null;
}

export function isMarkdownMessage(message: MessageDTO) {
  const payload = messagePayloadRecord(message);
  return payload.contentFormat === "markdown" || payload.markdown === true || isAiAssistantMessage(message);
}

export const MARKDOWN_ALLOWED_TAGS = [
  "p", "br", "strong", "b", "em", "i", "u", "s", "del", "a", "code", "pre",
  "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "hr",
  "span", "table", "thead", "tbody", "tr", "th", "td"
];

export function renderMarkdownToHtml(md: string): string {
  if (!md) return "";
  let raw = "";
  try {
    raw = marked.parse(md, { breaks: true, gfm: true, async: false }) as string;
  } catch {
    raw = "";
  }
  if (!raw) return "";
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: MARKDOWN_ALLOWED_TAGS,
    ALLOWED_ATTR: ["href", "target", "rel", "title"],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ["script", "style", "img", "iframe", "object", "embed", "form", "input", "button"],
    FORBID_ATTR: ["src", "style", "onerror", "onload", "onclick", "onmouseover"]
  });
}

export type BibleRichTextSegment =
  | { kind: "html"; key: string; html: string }
  | { kind: "reference"; key: string; reference: string; className?: string };

export function textContentHtml(text: string, linkify: LinkifyMessageHtml) {
  const root = document.createElement("div");
  root.textContent = text || "";
  return linkify(root.innerHTML.replace(/\n/g, "<br />"));
}

export function splitBibleTextNode(text: string, keyPrefix: string, inlineTags: string[] = []) {
  const segments: BibleRichTextSegment[] = [];
  const referenceClass = inlineTags.some((tag) => tag === "s" || tag === "del") ? "text-struck" : undefined;
  let cursor = 0;
  for (const match of extractBibleReferenceMatches(text)) {
    if (match.start > cursor) segments.push({ kind: "html", key: `${keyPrefix}-t-${cursor}`, html: wrapInlineHtml(escapeHtmlText(text.slice(cursor, match.start)), inlineTags) });
    segments.push({ kind: "reference", key: `${keyPrefix}-r-${match.start}`, reference: match.reference, className: referenceClass });
    cursor = match.end;
  }
  if (cursor < text.length) segments.push({ kind: "html", key: `${keyPrefix}-t-${cursor}`, html: wrapInlineHtml(escapeHtmlText(text.slice(cursor)), inlineTags) });
  return segments;
}

export function bibleRichTextSegmentsFromHtml(html: string, keyPrefix: string, linkify: LinkifyMessageHtml): BibleRichTextSegment[] {
  const root = document.createElement("div");
  root.innerHTML = linkify(html || "");
  const segments: BibleRichTextSegment[] = [];
  let index = 0;
  const walk = (node: Node, inlineTags: string[] = []) => {
    if (node.nodeType === Node.TEXT_NODE) {
      segments.push(...splitBibleTextNode(node.textContent || "", `${keyPrefix}-${index++}`, inlineTags));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as HTMLElement;
    if (element.tagName === "A") {
      segments.push({ kind: "html", key: `${keyPrefix}-a-${index++}`, html: element.outerHTML });
      return;
    }
    if (element.tagName === "BR") {
      segments.push({ kind: "html", key: `${keyPrefix}-br-${index++}`, html: "<br />" });
      return;
    }
    const tag = element.tagName.toLowerCase();
    const nextTags = ["b", "strong", "i", "em", "u", "s", "del"].includes(tag) ? [...inlineTags, tag] : inlineTags;
    for (const child of Array.from(element.childNodes)) walk(child, nextTags);
  };
  for (const child of Array.from(root.childNodes)) walk(child);
  return segments;
}

export function bibleRichTextSegmentsFromText(text: string, keyPrefix: string) {
  return splitBibleTextNode(text || "", keyPrefix);
}

export const chainTopicRichTextSegments = memoizeMessage((message: MessageDTO) => bibleRichTextSegmentsFromText(chainPayload(message).topic || "", `chain-${message.id}`));

export function bibleReferencesFromHtml(html: string) {
  return extractBibleReferencesFromText(plainTextFromHtml(html));
}

export function messageBibleReferences(message: MessageDTO) {
  return message.type === "text" ? bibleReferencesFromHtml(message.content) : [];
}

export function chainBibleReferences(message: MessageDTO) {
  return message.type === "chain" ? extractBibleReferencesFromText(chainPayload(message).topic || "") : [];
}

export function messageBibleReferenceScope(message: MessageDTO, area: "content" | "chain") {
  return `${area}:${message.id}`;
}
