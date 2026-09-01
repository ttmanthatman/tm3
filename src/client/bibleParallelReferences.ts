export type BibleParallelReferenceSegment =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; reference: string };

const rangeTokens = ["……", "...", "——", "--", "－", "–", "—", "―", "﹣", "～", "~"];

export function bibleParallelReferenceSegments(text: string): BibleParallelReferenceSegment[] {
  const prefix = text.match(/^\s*[（(]/)?.[0] || "";
  const suffix = text.match(/[）)]\s*$/)?.[0] || "";
  const innerStart = prefix.length;
  const innerEnd = suffix ? text.length - suffix.length : text.length;
  const inner = text.slice(innerStart, innerEnd);
  const pieces = inner.split(/([；;])/);
  const segments: BibleParallelReferenceSegment[] = [];
  if (prefix) segments.push({ kind: "text", text: prefix });
  let linkCount = 0;

  for (const piece of pieces) {
    if (!piece) continue;
    if (/^[；;]$/.test(piece)) {
      segments.push({ kind: "text", text: piece === ";" ? "；" : piece });
      continue;
    }
    const leading = piece.match(/^\s*/)?.[0] || "";
    const trailing = piece.match(/\s*$/)?.[0] || "";
    const candidate = piece.trim();
    const display = normalizeParallelReferenceDisplay(candidate);
    if (looksLikeParallelReference(display)) {
      if (leading) segments.push({ kind: "text", text: leading });
      segments.push({ kind: "link", text: display, reference: display.replace(/，/g, ",") });
      if (trailing) segments.push({ kind: "text", text: trailing });
      linkCount += 1;
    } else {
      segments.push({ kind: "text", text: piece });
    }
  }
  if (suffix) segments.push({ kind: "text", text: suffix });
  return linkCount ? mergeTextSegments(segments) : [{ kind: "text", text }];
}

function normalizeParallelReferenceDisplay(value: string) {
  let normalized = convertFullWidthDigits(value).replace(/[·．。：﹕]/g, ":");
  for (const token of rangeTokens) normalized = normalized.split(token).join("-");
  return normalized.replace(/\s+/g, "");
}

function looksLikeParallelReference(value: string) {
  return /[^\d\s,:，-]+\d+:\d+/.test(value);
}

function convertFullWidthDigits(value: string) {
  return [...value].map((character) => {
    const code = character.charCodeAt(0);
    return code >= 0xff10 && code <= 0xff19 ? String.fromCharCode(code - 0xff10 + 0x30) : character;
  }).join("");
}

function mergeTextSegments(segments: BibleParallelReferenceSegment[]) {
  const merged: BibleParallelReferenceSegment[] = [];
  for (const segment of segments) {
    const previous = merged.at(-1);
    if (segment.kind === "text" && previous?.kind === "text") previous.text += segment.text;
    else merged.push(segment);
  }
  return merged;
}
