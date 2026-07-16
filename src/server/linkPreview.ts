import dns from "node:dns/promises";
import net from "node:net";
import type { LinkPreviewDTO } from "../shared/types.js";

const LINK_PREVIEW_MAX_BYTES = 350 * 1024;
const LINK_PREVIEW_TIMEOUT_MS = 7000;
const LINK_PREVIEW_MAX_REDIRECTS = 3;

export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreviewDTO> {
  const { html, url } = await fetchLinkPreviewHtml(rawUrl);
  return parseLinkPreview(html, url);
}

function normalizePreviewUrl(rawUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("链接格式不正确");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("只支持 http 或 https 链接");
  if (parsed.username || parsed.password) throw new Error("链接不能包含用户名或密码");
  if (parsed.port && !["80", "443"].includes(parsed.port)) throw new Error("链接端口不支持预览");
  parsed.hash = "";
  return parsed;
}

function isBlockedPreviewAddress(address: string) {
  const family = net.isIP(address);
  if (family === 4) {
    const parts = address.split(".").map(Number);
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (family === 6) {
    const value = address.toLowerCase();
    return value === "::1" || value === "::" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:");
  }
  return true;
}

async function assertPublicPreviewHost(url: URL) {
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) throw new Error("本地链接不能生成预览");
  const records = await dns.lookup(hostname, { all: true, verbatim: false });
  if (!records.length || records.some((record) => isBlockedPreviewAddress(record.address))) throw new Error("此链接不能生成预览");
}

function decodeHtmlEntities(input?: string) {
  return String(input || "")
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)))
    .replace(/&#x([0-9a-f]+);/gi, (_, value) => String.fromCodePoint(parseInt(value, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function parseHtmlAttributes(tag: string) {
  const attrs: Record<string, string> = {};
  const pattern = /([^\s"'=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  for (const match of tag.matchAll(pattern)) attrs[match[1].toLowerCase()] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? "");
  return attrs;
}

function firstMetaContent(html: string, keys: string[]) {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseHtmlAttributes(match[0]);
    const key = (attrs.property || attrs.name || attrs.itemprop || "").toLowerCase();
    if (wanted.has(key) && attrs.content) return attrs.content;
  }
  return "";
}

function firstSrcsetUrl(value: string) {
  const candidates = value
    .split(",")
    .map((item) => item.trim().split(/\s+/, 1)[0])
    .filter(Boolean);
  return candidates.at(-1) || "";
}

function numericImageHint(attrs: Record<string, string>, source: string, name: "width" | "height") {
  const direct = Number.parseInt(attrs[name] || "", 10);
  if (Number.isFinite(direct)) return direct;
  const styled = Number.parseInt(attrs.style?.match(new RegExp(`${name}\\s*:\\s*(\\d+)`, "i"))?.[1] || "", 10);
  if (Number.isFinite(styled)) return styled;
  if (name === "width") {
    const queryWidth = Number.parseInt(source.match(/[?&](?:w|width)=(\d+)/i)?.[1] || "", 10);
    if (Number.isFinite(queryWidth)) return queryWidth;
  }
  return 0;
}

function imageCandidateScore(attrs: Record<string, string>, source: string, index: number) {
  const clues = `${source} ${attrs.class || ""} ${attrs.id || ""} ${attrs.alt || ""}`.toLowerCase();
  let score = Math.max(0, 20 - index);
  if (/(?:article|story|post|news|hero|cover|main|content|swiper|a-img)/.test(clues)) score += 150;
  if (/(?:logo|icon|avatar|sprite|emoji|qrcode|qr-code|wechat|footer|header|speech|play|loading)/.test(clues)) score -= 320;
  const width = numericImageHint(attrs, source, "width");
  const height = numericImageHint(attrs, source, "height");
  if (width) score += Math.min(100, Math.round(width / 10));
  if (width >= 600) score += 70;
  else if (width > 0 && width < 180) score -= 70;
  if (height >= 300) score += 45;
  else if (height > 0 && height < 120) score -= 45;
  if (attrs["data-src"] || attrs["data-original"] || attrs["data-lazy-src"]) score += 12;
  return score;
}

function bestImageSrc(html: string) {
  let best = { source: "", score: Number.NEGATIVE_INFINITY };
  let index = 0;
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const attrs = parseHtmlAttributes(match[0]);
    const source =
      attrs["data-src"] ||
      attrs["data-original"] ||
      attrs["data-lazy-src"] ||
      attrs["data-original-src"] ||
      attrs.src ||
      firstSrcsetUrl(attrs["data-srcset"] || attrs.srcset || "");
    if (!source || /^data:/i.test(source)) {
      index += 1;
      continue;
    }
    const score = imageCandidateScore(attrs, source, index);
    if (score > best.score) best = { source, score };
    index += 1;
  }
  return best.score > -100 ? best.source : "";
}

function absoluteHttpUrl(value: string, baseUrl: string) {
  if (!value) return "";
  try {
    const parsed = new URL(value, baseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

export function parseLinkPreview(html: string, finalUrl: string): LinkPreviewDTO {
  const title =
    firstMetaContent(html, ["og:title", "twitter:title"]) ||
    decodeHtmlEntities(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]*>/g, "") || "");
  const description = firstMetaContent(html, ["og:description", "twitter:description", "description"]);
  const image = absoluteHttpUrl(firstMetaContent(html, ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"]) || bestImageSrc(html), finalUrl);
  const siteName = firstMetaContent(html, ["og:site_name", "application-name"]) || new URL(finalUrl).hostname.replace(/^www\./, "");
  return {
    url: finalUrl,
    title: decodeHtmlEntities(title || siteName || finalUrl).slice(0, 220),
    description: decodeHtmlEntities(description).slice(0, 360) || undefined,
    image: image || undefined,
    siteName: decodeHtmlEntities(siteName).slice(0, 120) || undefined
  };
}

async function readResponseText(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < LINK_PREVIEW_MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    const slice = value.slice(0, Math.max(0, LINK_PREVIEW_MAX_BYTES - total));
    chunks.push(slice);
    total += slice.byteLength;
    if (value.byteLength > slice.byteLength) break;
  }
  await reader.cancel().catch(() => undefined);
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}

async function fetchLinkPreviewHtml(rawUrl: string, redirectCount = 0): Promise<{ html: string; url: string }> {
  if (redirectCount > LINK_PREVIEW_MAX_REDIRECTS) throw new Error("链接跳转次数过多");
  const url = normalizePreviewUrl(rawUrl);
  await assertPublicPreviewHost(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LINK_PREVIEW_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "team-chat-link-preview/1.0"
      }
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("链接跳转无效");
      return fetchLinkPreviewHtml(new URL(location, url).toString(), redirectCount + 1);
    }
    if (!response.ok) throw new Error(`网页读取失败：HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) throw new Error("链接不是网页");
    return { html: await readResponseText(response), url: url.toString() };
  } finally {
    clearTimeout(timeout);
  }
}
