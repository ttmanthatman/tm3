import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

// eBible USFX → 阅读器章节排版 JSON，以对应译本的经文 JSON 为基准逐节校验。
// 用法: npm run bible:import-layout -- <cmn-cu89s_usfx.zip> [output.json]
// 译本元数据（zip 校验和、经文 JSON 路径）登记在 TRANSLATIONS；新增译本时补充条目。
type TranslationMeta = {
  id: string;
  sourceUrl: string;
  sourceFile: string;
  sha256: string;
  versesJson: string;
  defaultOutput: string;
};

const TRANSLATIONS: Record<string, TranslationMeta> = {
  "cmn-cu89s": {
    id: "cmn-cu89s",
    sourceUrl: "https://ebible.org/Scriptures/cmn-cu89s_usfx.zip",
    sourceFile: "cmn-cu89s_usfx.xml",
    sha256: "4d8eca84f57f38202a9fc1551a6b667a135d88c31d5bed5d3a8287099ca34da5",
    versesJson: "src/server/bible/cmn-cu89s.json",
    defaultOutput: "src/server/bible/cmn-cu89s-layout.json"
  },
  cmncbs: {
    id: "cmncbs",
    sourceUrl: "https://ebible.org/Scriptures/cmncbs_usfx.zip",
    sourceFile: "cmncbs_usfx.xml",
    sha256: "7c5266220d70700b09d17b7e3a750a7d631e56acfa33747f8fd97bd75f8b3fb3",
    versesJson: "src/server/bible/cmncbs.json",
    defaultOutput: "src/server/bible/cmncbs-layout.json"
  }
};

type CanonicalVerse = {
  book: string;
  chapter: number;
  verse: number;
  endVerse: number;
  text: string;
};

type DraftFragment = { book: string; chapter: number; verse: number; text: string };
type DraftBlock =
  | { kind: "h"; level: number; text: string }
  | { kind: "r" | "d" | "sp"; text: string; anchor?: { book: string; chapter: number; verse: number } }
  | { kind: "b" }
  | { kind: "p" | "q"; fragments: DraftFragment[] };

type LayoutFragment = [verse: number, start: number, end: number];
type LayoutBlock =
  | [kind: "h", level: number, text: string]
  | [kind: "r" | "d" | "sp", text: string]
  | [kind: "b"]
  | [kind: "p" | "q", fragments: LayoutFragment[]];

const input = process.argv[2];
if (!input) throw new Error("usage: npm run bible:import-layout -- <cmn-cu89s_usfx.zip> [output.json]");
const id = path.basename(input).match(/^([a-z0-9-]+)_usfx\.zip$/i)?.[1]?.toLowerCase() || "";
const meta = TRANSLATIONS[id];
if (!meta) throw new Error(`unknown USFX translation id: ${id || input}`);
const output = path.resolve(process.argv[3] || meta.defaultOutput);

const archive = fs.readFileSync(path.resolve(input));
const checksum = createHash("sha256").update(archive).digest("hex");
if (checksum !== meta.sha256) {
  throw new Error(`unexpected USFX archive checksum: ${checksum}`);
}

const xml = execFileSync("unzip", ["-p", path.resolve(input), meta.sourceFile], {
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024
});

const biblePayload = JSON.parse(fs.readFileSync(path.resolve(meta.versesJson), "utf8")) as { id: string; verses: CanonicalVerse[] };
if (biblePayload.id !== meta.id) throw new Error(`verses JSON id ${biblePayload.id} does not match ${meta.id}`);
const canonicalVerses = biblePayload.verses;
const canonicalByKey = new Map(canonicalVerses.map((verse) => [verseKey(verse.book, verse.chapter, verse.verse), verse]));
const drafts = parseUsfx(xml);
const fragmentOffsets = validateAndLocateFragments(drafts, canonicalByKey);
const chapters: Record<string, LayoutBlock[]> = {};

for (const [key, blocks] of drafts) {
  const serialized: LayoutBlock[] = [];
  for (const block of blocks) {
    if (block.kind === "h") {
      const text = cleanMetaText(block.text);
      if (text) serialized.push(["h", block.level, text]);
    } else if (block.kind === "r" || block.kind === "d" || block.kind === "sp") {
      const text = cleanMetaText(block.text);
      if (text) serialized.push([block.kind, text]);
    } else if (block.kind === "b") {
      serialized.push(["b"]);
    } else if ("fragments" in block) {
      const fragments = block.fragments.flatMap((fragment) => {
        const located = fragmentOffsets.get(fragment);
        return located ? [located] : [];
      });
      if (fragments.length) serialized.push([block.kind, fragments]);
    }
  }
  chapters[key] = serialized;
}

const result = {
  id: biblePayload.id,
  source: {
    url: meta.sourceUrl,
    format: "eBible USFX",
    sourceFile: meta.sourceFile,
    sha256: meta.sha256
  },
  chapters
};

fs.writeFileSync(output, `${JSON.stringify(result)}\n`);
console.log(`wrote ${Object.keys(chapters).length} structured chapters to ${output}`);

function parseUsfx(source: string) {
  const chapters = new Map<string, DraftBlock[]>();
  let book = "";
  let chapter = 0;
  let currentVerse: { book: string; chapter: number; verse: number } | null = null;
  let currentBlock: DraftBlock | null = null;
  let excludedDepth = 0;

  const finishBlock = () => {
    if (!currentBlock || !book || !chapter) {
      currentBlock = null;
      return;
    }
    const key = chapterKey(book, chapter);
    chapters.set(key, [...(chapters.get(key) || []), currentBlock]);
    currentBlock = null;
  };

  for (const match of source.matchAll(/<[^>]+>|[^<]+/g)) {
    const token = match[0];
    if (!token.startsWith("<")) {
      if (!currentBlock || excludedDepth) continue;
      const text = decodeXml(token).replace(/\r?\n/g, "");
      if (!text) continue;
      if (currentBlock.kind === "p" || currentBlock.kind === "q") {
        if (!currentVerse) continue;
        const last = currentBlock.fragments.at(-1);
        if (last && last.book === currentVerse.book && last.chapter === currentVerse.chapter && last.verse === currentVerse.verse) last.text += text;
        else currentBlock.fragments.push({ ...currentVerse, text });
      } else if ("text" in currentBlock) {
        currentBlock.text += text;
      }
      continue;
    }

    if (/^<\?|^<!/.test(token)) continue;
    const closing = /^<\//.test(token);
    const selfClosing = /\/\s*>$/.test(token);
    const name = token.match(/^<\/?\s*([\w-]+)/)?.[1]?.toLowerCase();
    if (!name) continue;

    if (closing) {
      if (name === "f" || name === "x") excludedDepth = Math.max(0, excludedDepth - 1);
      if (["s", "ms", "p", "q", "d", "sp"].includes(name)) finishBlock();
      continue;
    }

    const attributes = parseAttributes(token);
    if (name === "book") {
      finishBlock();
      book = attributes.id || "";
      chapter = 0;
      currentVerse = null;
    } else if (name === "c") {
      finishBlock();
      chapter = Number(attributes.id || 0);
      currentVerse = null;
    } else if ((name === "s" || name === "ms") && chapter) {
      finishBlock();
      currentBlock = { kind: "h", level: headingLevel(attributes.style), text: "" };
    } else if (name === "p" && chapter) {
      finishBlock();
      const style = attributes.style || attributes.sfm || "p";
      if (style === "r") currentBlock = { kind: "r", text: "" };
      else if (style === "sp") currentBlock = { kind: "sp", text: "", anchor: currentVerse ? { ...currentVerse } : undefined };
      else currentBlock = { kind: "p", fragments: [] };
    } else if (name === "q" && chapter) {
      finishBlock();
      currentBlock = { kind: "q", fragments: [] };
    } else if ((name === "d" || name === "sp") && chapter) {
      finishBlock();
      currentBlock = { kind: name, text: "", anchor: currentVerse ? { ...currentVerse } : undefined };
    } else if (name === "b" && chapter) {
      finishBlock();
      currentBlock = { kind: "b" };
      finishBlock();
    } else if (name === "v") {
      const bcv = attributes.bcv?.match(/^([^.]+)\.(\d+)\.(\d+)$/);
      const verse = Number((attributes.id || "").match(/^\d+/)?.[0] || bcv?.[3] || 0);
      currentVerse = bcv ? { book: bcv[1], chapter: Number(bcv[2]), verse } : { book, chapter, verse };
    } else if (name === "ve") {
      currentVerse = null;
    } else if (name === "f" || name === "x") {
      excludedDepth += 1;
    }

    if (selfClosing && (name === "f" || name === "x")) excludedDepth = Math.max(0, excludedDepth - 1);
  }
  finishBlock();
  return chapters;
}

function validateAndLocateFragments(drafts: Map<string, DraftBlock[]>, canonicalByKey: Map<string, CanonicalVerse>) {
  const fragmentsByVerse = new Map<string, DraftFragment[]>();
  const piecesByVerse = new Map<string, Array<{ fragment?: DraftFragment; text: string }>>();
  for (const blocks of drafts.values()) {
    const pendingPrefixes: string[] = [];
    for (const block of blocks) {
      if (block.kind === "d" && !block.anchor) {
        pendingPrefixes.push(block.text);
        continue;
      }
      if (block.kind === "sp" && block.anchor) {
        const key = verseKey(block.anchor.book, block.anchor.chapter, block.anchor.verse);
        piecesByVerse.set(key, [...(piecesByVerse.get(key) || []), { text: block.text }]);
        continue;
      }
      if (block.kind !== "p" && block.kind !== "q") continue;
      for (const fragment of block.fragments) {
        const key = verseKey(fragment.book, fragment.chapter, fragment.verse);
        if (pendingPrefixes.length) {
          piecesByVerse.set(key, [
            ...(piecesByVerse.get(key) || []),
            ...pendingPrefixes.splice(0).map((text) => ({ text }))
          ]);
        }
        fragmentsByVerse.set(key, [...(fragmentsByVerse.get(key) || []), fragment]);
        piecesByVerse.set(key, [...(piecesByVerse.get(key) || []), { fragment, text: fragment.text }]);
      }
    }
  }

  const offsets = new Map<DraftFragment, LayoutFragment>();
  const failures: string[] = [];
  for (const [key, verse] of canonicalByKey) {
    const pieces = piecesByVerse.get(key) || [];
    const expected = cleanCanonicalText(verse.text);
    const actual = pieces.map((piece) => cleanVersePart(piece.text)).join("");
    if (stripWhitespace(actual) !== stripWhitespace(expected)) {
      failures.push(`${key}: expected ${JSON.stringify(expected)} got ${JSON.stringify(actual.trim())}`);
      if (failures.length >= 10) break;
      continue;
    }

    let cursor = 0;
    for (const piece of pieces) {
      const significant = stripWhitespace(cleanVersePart(piece.text));
      if (!significant) continue;
      while (cursor < expected.length && isWhitespace(expected[cursor])) cursor += 1;
      const start = cursor;
      cursor = consumeSignificant(expected, cursor, significant, key);
      if (piece.fragment) offsets.set(piece.fragment, [verse.verse, start, cursor]);
    }
  }

  if (fragmentsByVerse.size !== canonicalByKey.size) {
    failures.push(`verse count mismatch: USFX ${fragmentsByVerse.size}, VPL ${canonicalByKey.size}`);
  }
  for (const key of fragmentsByVerse.keys()) {
    if (!canonicalByKey.has(key)) failures.push(`unexpected USFX verse ${key}`);
  }
  if (failures.length) throw new Error(`USFX/VPL validation failed:\n${failures.join("\n")}`);
  return offsets;
}

function parseAttributes(tag: string) {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w-]+)="([^"]*)"/g)) result[match[1]] = decodeXml(match[2]);
  return result;
}

function decodeXml(text: string) {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    if (entity === "amp") return "&";
    if (entity === "lt") return "<";
    if (entity === "gt") return ">";
    if (entity === "quot") return '"';
    if (entity === "apos") return "'";
    return String.fromCodePoint(Number.parseInt(entity.slice(entity[1].toLowerCase() === "x" ? 2 : 1), entity[1].toLowerCase() === "x" ? 16 : 10));
  });
}

function headingLevel(style = "s") {
  const level = Number(style.match(/\d+$/)?.[0] || 1);
  return Math.max(1, Math.min(2, level));
}

function cleanVersePart(text: string) {
  return text.replace(/\u3000/g, "");
}

function cleanCanonicalText(text: string) {
  return cleanVersePart(text).trim();
}

function stripWhitespace(text: string) {
  return text.replace(/\s/g, "");
}

function isWhitespace(character: string) {
  return /\s/.test(character);
}

function consumeSignificant(expected: string, start: number, significant: string, key: string) {
  let cursor = start;
  for (const character of significant) {
    while (cursor < expected.length && isWhitespace(expected[cursor])) cursor += 1;
    if (expected[cursor] !== character) throw new Error(`cannot locate USFX fragment in ${key}`);
    cursor += 1;
  }
  return cursor;
}

function cleanMetaText(text: string) {
  return text.replace(/\u3000/g, "").replace(/\s+/g, " ").trim();
}

function verseKey(book: string, chapter: number, verse: number) {
  return `${book}.${chapter}.${verse}`;
}

function chapterKey(book: string, chapter: number) {
  return `${book}.${chapter}`;
}
