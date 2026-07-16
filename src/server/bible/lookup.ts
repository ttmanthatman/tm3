import biblePayload from "./cmn-cu89s.json" with { type: "json" };
import bibleLayoutPayload from "./cmn-cu89s-layout.json" with { type: "json" };
import type {
  BibleCatalogDTO,
  BibleChapterBlockDTO,
  BibleChapterDTO,
  BibleLookupDTO,
  BibleTextMatchRangeDTO,
  BibleTextSearchDTO,
  BibleTextSearchItemDTO,
  BibleVerseLineDTO
} from "../../shared/types.js";

type BibleBook = {
  code: string;
  chineseName: string;
  aliases: string[];
};

type BibleVerse = {
  book: string;
  chapter: number;
  verse: number;
  endVerse: number;
  text: string;
  order: number;
};

type BiblePayload = {
  id: string;
  displayName: string;
  verses: BibleVerse[];
};

type BibleLayoutFragment = [verse: number, start: number, end: number];
type BibleLayoutBlock =
  | [kind: "h", level: number, text: string]
  | [kind: "r", text: string]
  | [kind: "d", text: string]
  | [kind: "sp", text: string]
  | [kind: "b"]
  | [kind: "p", fragments: BibleLayoutFragment[]]
  | [kind: "q", fragments: BibleLayoutFragment[]];

type BibleLayoutPayload = {
  id: string;
  chapters: Record<string, BibleLayoutBlock[]>;
};

type PassageReference = {
  book: BibleBook;
  startChapter: number;
  startVerse?: number;
  endChapter: number;
  endVerse?: number;
};

type ParsedReference = {
  passages: PassageReference[];
};

const BOOKS: BibleBook[] = [
  { code: "GEN", chineseName: "创世记", aliases: ["创世记", "创世纪", "创", "Genesis", "Gen", "Ge", "Gn"] },
  { code: "EXO", chineseName: "出埃及记", aliases: ["出埃及记", "出", "Exodus", "Exod", "Exo", "Ex"] },
  { code: "LEV", chineseName: "利未记", aliases: ["利未记", "利", "Leviticus", "Lev", "Le"] },
  { code: "NUM", chineseName: "民数记", aliases: ["民数记", "民", "Numbers", "Num", "Nu", "Nm", "Nb"] },
  { code: "DEU", chineseName: "申命记", aliases: ["申命记", "申", "Deuteronomy", "Deut", "Deu", "Dt"] },
  { code: "JOS", chineseName: "约书亚记", aliases: ["约书亚记", "书", "Joshua", "Josh", "Jos"] },
  { code: "JDG", chineseName: "士师记", aliases: ["士师记", "士", "Judges", "Judg", "Jdg", "Jg"] },
  { code: "RUT", chineseName: "路得记", aliases: ["路得记", "得", "Ruth", "Rut", "Ru"] },
  { code: "1SA", chineseName: "撒母耳记上", aliases: ["撒母耳记上", "撒母耳上", "撒上", "1 Samuel", "1Samuel", "1 Sam", "1Sam", "I Samuel", "ISamuel", "I Sam", "ISam"] },
  { code: "2SA", chineseName: "撒母耳记下", aliases: ["撒母耳记下", "撒母耳下", "撒下", "2 Samuel", "2Samuel", "2 Sam", "2Sam", "II Samuel", "IISamuel", "II Sam", "IISam"] },
  { code: "1KI", chineseName: "列王纪上", aliases: ["列王纪上", "王上", "1 Kings", "1Kings", "1 Kgs", "1Kgs", "I Kings", "IKings"] },
  { code: "2KI", chineseName: "列王纪下", aliases: ["列王纪下", "王下", "2 Kings", "2Kings", "2 Kgs", "2Kgs", "II Kings", "IIKings"] },
  { code: "1CH", chineseName: "历代志上", aliases: ["历代志上", "代上", "1 Chronicles", "1Chronicles", "1 Chron", "1Chron", "I Chronicles", "IChronicles"] },
  { code: "2CH", chineseName: "历代志下", aliases: ["历代志下", "代下", "2 Chronicles", "2Chronicles", "2 Chron", "2Chron", "II Chronicles", "IIChronicles"] },
  { code: "EZR", chineseName: "以斯拉记", aliases: ["以斯拉记", "拉", "Ezra", "Ezr"] },
  { code: "NEH", chineseName: "尼希米记", aliases: ["尼希米记", "尼", "Nehemiah", "Neh"] },
  { code: "EST", chineseName: "以斯帖记", aliases: ["以斯帖记", "斯", "Esther", "Est"] },
  { code: "JOB", chineseName: "约伯记", aliases: ["约伯记", "伯", "Job", "Jb"] },
  { code: "PSA", chineseName: "诗篇", aliases: ["诗篇", "诗", "Psalms", "Psalm", "Ps", "Psa"] },
  { code: "PRO", chineseName: "箴言", aliases: ["箴言", "箴", "Proverbs", "Prov", "Pro", "Pr"] },
  { code: "ECC", chineseName: "传道书", aliases: ["传道书", "传", "Ecclesiastes", "Eccl", "Ecc", "Qoheleth"] },
  { code: "SNG", chineseName: "雅歌", aliases: ["雅歌", "歌", "Song of Songs", "SongofSongs", "Song", "Songs", "Sng", "Song of Solomon", "SongofSolomon"] },
  { code: "ISA", chineseName: "以赛亚书", aliases: ["以赛亚书", "赛", "Isaiah", "Isa"] },
  { code: "JER", chineseName: "耶利米书", aliases: ["耶利米书", "耶", "Jeremiah", "Jer"] },
  { code: "LAM", chineseName: "耶利米哀歌", aliases: ["耶利米哀歌", "哀", "Lamentations", "Lam"] },
  { code: "EZK", chineseName: "以西结书", aliases: ["以西结书", "结", "Ezekiel", "Ezek", "Ezk"] },
  { code: "DAN", chineseName: "但以理书", aliases: ["但以理书", "但", "Daniel", "Dan", "Da"] },
  { code: "HOS", chineseName: "何西阿书", aliases: ["何西阿书", "何", "Hosea", "Hos"] },
  { code: "JOL", chineseName: "约珥书", aliases: ["约珥书", "珥", "Joel", "Joe", "Jol"] },
  { code: "AMO", chineseName: "阿摩司书", aliases: ["阿摩司书", "摩", "Amos", "Amo", "Am"] },
  { code: "OBA", chineseName: "俄巴底亚书", aliases: ["俄巴底亚书", "俄", "Obadiah", "Obad", "Oba"] },
  { code: "JON", chineseName: "约拿书", aliases: ["约拿书", "拿", "Jonah", "Jon"] },
  { code: "MIC", chineseName: "弥迦书", aliases: ["弥迦书", "弥", "Micah", "Mic"] },
  { code: "NAM", chineseName: "那鸿书", aliases: ["那鸿书", "鸿", "Nahum", "Nah", "Nam"] },
  { code: "HAB", chineseName: "哈巴谷书", aliases: ["哈巴谷书", "哈", "Habakkuk", "Hab"] },
  { code: "ZEP", chineseName: "西番雅书", aliases: ["西番雅书", "番", "Zephaniah", "Zeph", "Zep"] },
  { code: "HAG", chineseName: "哈该书", aliases: ["哈该书", "该", "Haggai", "Hag"] },
  { code: "ZEC", chineseName: "撒迦利亚书", aliases: ["撒迦利亚书", "亚", "Zechariah", "Zech", "Zec"] },
  { code: "MAL", chineseName: "玛拉基书", aliases: ["玛拉基书", "玛", "Malachi", "Mal"] },
  { code: "MAT", chineseName: "马太福音", aliases: ["马太福音", "马太", "太", "Matthew", "Matt", "Mat", "Mt"] },
  { code: "MRK", chineseName: "马可福音", aliases: ["马可福音", "马可", "可", "Mark", "Mrk", "Mk"] },
  { code: "LUK", chineseName: "路加福音", aliases: ["路加福音", "路加", "陆家", "路", "Luke", "Luk", "Lk"] },
  { code: "JHN", chineseName: "约翰福音", aliases: ["约翰福音", "约翰", "约", "John", "Jhn", "Jn"] },
  { code: "ACT", chineseName: "使徒行传", aliases: ["使徒行传", "徒", "Acts", "Act", "Ac"] },
  { code: "ROM", chineseName: "罗马书", aliases: ["罗马书", "罗", "Romans", "Rom", "Ro"] },
  { code: "1CO", chineseName: "哥林多前书", aliases: ["哥林多前书", "林前", "1 Corinthians", "1Corinthians", "1 Cor", "1Cor", "I Corinthians", "ICorinthians"] },
  { code: "2CO", chineseName: "哥林多后书", aliases: ["哥林多后书", "林后", "2 Corinthians", "2Corinthians", "2 Cor", "2Cor", "II Corinthians", "IICorinthians"] },
  { code: "GAL", chineseName: "加拉太书", aliases: ["加拉太书", "加", "Galatians", "Gal"] },
  { code: "EPH", chineseName: "以弗所书", aliases: ["以弗所书", "弗", "Ephesians", "Eph"] },
  { code: "PHP", chineseName: "腓立比书", aliases: ["腓立比书", "腓", "Philippians", "Phil", "Php"] },
  { code: "COL", chineseName: "歌罗西书", aliases: ["歌罗西书", "西", "Colossians", "Col"] },
  { code: "1TH", chineseName: "帖撒罗尼迦前书", aliases: ["帖撒罗尼迦前书", "帖前", "1 Thessalonians", "1Thessalonians", "1 Thess", "1Thess", "I Thessalonians", "IThessalonians"] },
  { code: "2TH", chineseName: "帖撒罗尼迦后书", aliases: ["帖撒罗尼迦后书", "帖后", "2 Thessalonians", "2Thessalonians", "2 Thess", "2Thess", "II Thessalonians", "IIThessalonians"] },
  { code: "1TI", chineseName: "提摩太前书", aliases: ["提摩太前书", "提前", "1 Timothy", "1Timothy", "1 Tim", "1Tim", "I Timothy", "ITim"] },
  { code: "2TI", chineseName: "提摩太后书", aliases: ["提摩太后书", "提后", "2 Timothy", "2Timothy", "2 Tim", "2Tim", "II Timothy", "IITim"] },
  { code: "TIT", chineseName: "提多书", aliases: ["提多书", "多", "Titus", "Tit"] },
  { code: "PHM", chineseName: "腓利门书", aliases: ["腓利门书", "门", "Philemon", "Philem", "Phm"] },
  { code: "HEB", chineseName: "希伯来书", aliases: ["希伯来书", "来", "Hebrews", "Heb"] },
  { code: "JAS", chineseName: "雅各书", aliases: ["雅各书", "雅", "James", "Jas", "Jam"] },
  { code: "1PE", chineseName: "彼得前书", aliases: ["彼得前书", "彼前", "1 Peter", "1Peter", "1 Pet", "1Pet", "I Peter", "IPeter"] },
  { code: "2PE", chineseName: "彼得后书", aliases: ["彼得后书", "彼后", "2 Peter", "2Peter", "2 Pet", "2Pet", "II Peter", "IIPeter"] },
  { code: "1JN", chineseName: "约翰一书", aliases: ["约翰一书", "约一", "1 John", "1John", "1 Jn", "1Jn", "I John", "IJohn"] },
  { code: "2JN", chineseName: "约翰二书", aliases: ["约翰二书", "约二", "2 John", "2John", "2 Jn", "2Jn", "II John", "IIJohn"] },
  { code: "3JN", chineseName: "约翰三书", aliases: ["约翰三书", "约三", "3 John", "3John", "3 Jn", "3Jn", "III John", "IIIJohn"] },
  { code: "JUD", chineseName: "犹大书", aliases: ["犹大书", "犹", "Jude", "Jud"] },
  { code: "REV", chineseName: "启示录", aliases: ["启示录", "启", "Revelation", "Revelations", "Rev", "Re"] }
];

const payload = biblePayload as BiblePayload;
const layoutPayload = bibleLayoutPayload as unknown as BibleLayoutPayload;
if (layoutPayload.id !== payload.id) throw new Error("Bible text and layout source IDs do not match");
const bookByCode = new Map(BOOKS.map((book) => [book.code, book]));
const bookOrder = new Map(BOOKS.map((book, index) => [book.code, index]));
const startAliases = BOOKS.flatMap((book) => [book.chineseName, book.code, ...book.aliases].map((alias) => ({ alias: normalizeBook(alias), book })))
  .filter((item) => item.alias)
  .sort((left, right) => right.alias.length - left.alias.length);
const verseMap = new Map<string, BibleVerse>();
const chapterMap = new Map<string, BibleVerse[]>();

for (const verse of payload.verses) {
  for (let verseNumber = verse.verse; verseNumber <= verse.endVerse; verseNumber += 1) {
    verseMap.set(verseKey(verse.book, verse.chapter, verseNumber), verse);
  }
  const key = chapterKey(verse.book, verse.chapter);
  chapterMap.set(key, [...(chapterMap.get(key) || []), verse]);
}

for (const [key, verses] of chapterMap.entries()) {
  chapterMap.set(
    key,
    verses.sort((left, right) => (left.order === right.order ? left.verse - right.verse : left.order - right.order))
  );
}

const searchableVerses = [...payload.verses].sort(compareBibleVerses);
const catalogBooks = BOOKS.map((book) => ({
  code: book.code,
  name: book.chineseName,
  chapterCount: Math.max(0, ...payload.verses.filter((verse) => verse.book === book.code).map((verse) => verse.chapter))
}));
const catalog: BibleCatalogDTO = {
  translation: payload.displayName,
  sourceId: payload.id,
  oldTestament: catalogBooks.slice(0, 39),
  newTestament: catalogBooks.slice(39)
};

export function bibleCatalog(): BibleCatalogDTO {
  return catalog;
}

export function searchBibleText(rawQuery: string, offset = 0, limit = 50): BibleTextSearchDTO {
  const query = rawQuery.replace(/\u3000/g, " ").replace(/\s+/g, " ").trim();
  if (!query) throw new Error("empty query");
  const normalizedQuery = normalizeSearchText(query);
  const phraseMatches = searchableVerses.flatMap((verse) => {
    const text = cleanVerseText(verse.text);
    const matches = findTextMatches(text, [normalizedQuery]);
    return matches.length ? [{ verse, matches }] : [];
  });
  const terms = query.split(/\s+/).map(normalizeSearchText).filter(Boolean);
  const useAllTerms = phraseMatches.length === 0 && terms.length > 1;
  const matches = useAllTerms
    ? searchableVerses.flatMap((verse) => {
        const text = cleanVerseText(verse.text);
        const normalizedText = normalizeSearchText(text);
        if (!terms.every((term) => normalizedText.includes(term))) return [];
        return [{ verse, matches: findTextMatches(text, terms) }];
      })
    : phraseMatches;
  const safeOffset = Math.max(0, Math.floor(offset));
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  const items: BibleTextSearchItemDTO[] = matches.slice(safeOffset, safeOffset + safeLimit).map(({ verse, matches: ranges }) => ({
    verse: serializeVerse(verse),
    matches: ranges
  }));
  return {
    query,
    mode: useAllTerms ? "allTerms" : "phrase",
    terms: useAllTerms ? terms : [normalizedQuery],
    total: matches.length,
    offset: safeOffset,
    limit: safeLimit,
    items
  };
}

export function lookupBibleReference(reference: string): BibleLookupDTO {
  const parsed = parseReference(reference);
  const verses = versesForParsedReference(parsed);
  return {
    reference,
    normalizedReference: displayParsedReference(parsed),
    translation: payload.displayName,
    sourceId: payload.id,
    verses: verses.map(serializeVerse)
  };
}

export function lookupBibleChapter(bookCode: string, chapter: number): BibleChapterDTO {
  const book = bookByCode.get(bookCode.toUpperCase());
  if (!book || !Number.isInteger(chapter) || chapter < 1) throw new Error("invalid chapter");
  const verses = versesForWholeChapter(book, chapter);
  const rawBlocks = layoutPayload.chapters[`${book.code}.${chapter}`];
  if (!rawBlocks) throw new Error("chapter layout not found");

  const serializedVerses = verses.map(serializeVerse);
  const serializedByStartVerse = new Map(serializedVerses.map((verse) => [verse.verse, verse]));
  const numberedVerses = new Set<number>();
  const blocks: BibleChapterBlockDTO[] = [];
  for (const block of rawBlocks) {
    if (block[0] === "h") {
      blocks.push({ type: "heading", level: block[1] === 2 ? 2 : 1, text: block[2] });
      continue;
    }
    if (block[0] === "r") {
      blocks.push({ type: "parallel", text: block[1] });
      continue;
    }
    if (block[0] === "d") {
      blocks.push({ type: "description", text: block[1] });
      continue;
    }
    if (block[0] === "sp") {
      blocks.push({ type: "speaker", text: block[1] });
      continue;
    }
    if (block[0] === "b") {
      blocks.push({ type: "spacing" });
      continue;
    }

    const fragments = block[1].flatMap(([verseNumber, start, end]) => {
      const verse = serializedByStartVerse.get(verseNumber);
      if (!verse || start < 0 || end <= start || end > verse.text.length) return [];
      const showVerseNumber = !numberedVerses.has(verseNumber);
      numberedVerses.add(verseNumber);
      return [{ verse, text: verse.text.slice(start, end), start, end, showVerseNumber }];
    });
    if (fragments.length) blocks.push({ type: "paragraph", style: block[0] === "q" ? "poetry" : "prose", fragments });
  }

  return {
    bookCode: book.code,
    bookName: book.chineseName,
    chapter,
    translation: payload.displayName,
    sourceId: payload.id,
    verses: serializedVerses,
    blocks
  };
}

function parseReference(rawReference: string): ParsedReference {
  const normalized = normalizeReference(rawReference);
  if (!normalized) throw new Error("empty reference");
  const chunks = normalized
    .split(",")
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  if (!chunks.length) throw new Error("unrecognized reference");

  const passages: PassageReference[] = [];
  let currentBook: BibleBook | undefined;
  let currentChapter: number | undefined;
  for (const chunk of chunks) {
    const parsed = parseChunk(chunk, currentBook, currentChapter);
    passages.push(parsed.passage);
    currentBook = parsed.passage.book;
    currentChapter = parsed.contextChapter;
  }
  return { passages };
}

function normalizeReference(raw: string) {
  let text = raw.trim();
  text = text.replace(/\n|\t|\u3000/g, " ");
  text = text.replace(/[：﹕]/g, ":");
  text = text.replace(/[“”"']/g, "");
  text = text.replace(/[《》〈〉<>「」『』【】\[\]]/g, "");
  text = convertFullWidthDigits(text);
  text = normalizeRanges(text);
  text = text.replace(/[，、；;｜|\\]/g, ",");
  return text.replace(/\s+/g, " ").trim();
}

function convertFullWidthDigits(text: string) {
  return [...text]
    .map((char) => {
      const code = char.charCodeAt(0);
      return code >= 0xff10 && code <= 0xff19 ? String.fromCharCode(code - 0xff10 + 0x30) : char;
    })
    .join("");
}

function normalizeRanges(raw: string) {
  let text = raw;
  for (const token of ["……", "...", "——", "--", "－", "–", "—", "―", "﹣", "～", "~", "^", "到", "至"]) {
    text = text.split(token).join("-");
  }
  return text.replace(/(\d)\s*to\s*(\d)/gi, "$1-$2");
}

function parseChunk(rawChunk: string, currentBook?: BibleBook, currentChapter?: number) {
  const compact = rawChunk.trim().toLowerCase().replace(/\s+/g, "");
  if (!compact) throw new Error("unrecognized reference");

  let book = currentBook;
  let body = compact;
  const bookMatch = bookAtStart(compact);
  if (bookMatch) {
    book = bookMatch.book;
    body = bookMatch.remaining;
  }
  if (!book) throw new Error("unknown book");

  const chapterStyle = parseChapterStyle(body, book, currentChapter);
  if (chapterStyle) return { passage: chapterStyle, contextChapter: chapterStyle.endChapter };
  const colonStyle = parseColonStyle(body, book);
  if (colonStyle) return { passage: colonStyle, contextChapter: colonStyle.endChapter };
  const inheritedStyle = parseInheritedVerseStyle(body, book, currentChapter);
  if (inheritedStyle) return { passage: inheritedStyle, contextChapter: inheritedStyle.endChapter };
  throw new Error("unrecognized reference");
}

function bookAtStart(compactText: string) {
  const text = normalizeBookStart(compactText);
  for (const candidate of startAliases) {
    if (text.startsWith(candidate.alias)) {
      return { book: candidate.book, remaining: text.slice(candidate.alias.length) };
    }
  }
  return null;
}

function parseChapterStyle(body: string, book: BibleBook, currentChapter?: number): PassageReference | null {
  if (!body.includes("章") && !body.includes("节")) return null;
  const chapterMatch = body.match(/^第?(\d+)章(?:第?(\d+)(?:-(\d+))?节?)?$/);
  if (chapterMatch) {
    const chapter = numberGroup(chapterMatch, 1);
    const startVerse = optionalNumberGroup(chapterMatch, 2);
    const endVerse = optionalNumberGroup(chapterMatch, 3) ?? startVerse;
    assertRange(startVerse, endVerse);
    return { book, startChapter: chapter, startVerse, endChapter: chapter, endVerse };
  }
  const verseMatch = body.match(/^第?(\d+)(?:-(\d+))?节$/);
  if (verseMatch && currentChapter) {
    const startVerse = numberGroup(verseMatch, 1);
    const endVerse = optionalNumberGroup(verseMatch, 2) ?? startVerse;
    assertRange(startVerse, endVerse);
    return { book, startChapter: currentChapter, startVerse, endChapter: currentChapter, endVerse };
  }
  return null;
}

function parseColonStyle(body: string, book: BibleBook): PassageReference | null {
  const crossChapter = body.match(/^(\d+):(\d+)-(\d+):(\d+)$/);
  if (crossChapter) {
    const startChapter = numberGroup(crossChapter, 1);
    const startVerse = numberGroup(crossChapter, 2);
    const endChapter = numberGroup(crossChapter, 3);
    const endVerse = numberGroup(crossChapter, 4);
    if (startChapter > endChapter || (startChapter === endChapter && startVerse > endVerse)) throw new Error("invalid range");
    return { book, startChapter, startVerse, endChapter, endVerse };
  }

  const verseRange = body.match(/^(\d+):(\d+)-(\d+)$/);
  if (verseRange) {
    const chapter = numberGroup(verseRange, 1);
    const startVerse = numberGroup(verseRange, 2);
    const endVerse = numberGroup(verseRange, 3);
    assertRange(startVerse, endVerse);
    return { book, startChapter: chapter, startVerse, endChapter: chapter, endVerse };
  }

  const singleVerse = body.match(/^(\d+):(\d+)$/);
  if (singleVerse) {
    const chapter = numberGroup(singleVerse, 1);
    const verse = numberGroup(singleVerse, 2);
    return { book, startChapter: chapter, startVerse: verse, endChapter: chapter, endVerse: verse };
  }
  return null;
}

function parseInheritedVerseStyle(body: string, book: BibleBook, currentChapter?: number): PassageReference | null {
  const range = body.match(/^(\d+)-(\d+)$/);
  if (range && currentChapter) {
    const startVerse = numberGroup(range, 1);
    const endVerse = numberGroup(range, 2);
    assertRange(startVerse, endVerse);
    return { book, startChapter: currentChapter, startVerse, endChapter: currentChapter, endVerse };
  }

  const single = body.match(/^(\d+)$/);
  if (single) {
    const number = numberGroup(single, 1);
    if (currentChapter) return { book, startChapter: currentChapter, startVerse: number, endChapter: currentChapter, endVerse: number };
    return { book, startChapter: number, endChapter: number };
  }
  return null;
}

function versesForParsedReference(parsedReference: ParsedReference) {
  const result: BibleVerse[] = [];
  const seen = new Set<string>();
  for (const passage of parsedReference.passages) {
    for (const verse of versesForPassage(passage)) {
      const key = canonicalVerseKey(verse);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(verse);
    }
  }
  return result.sort(compareBibleVerses);
}

function versesForPassage(passage: PassageReference) {
  if (passage.startVerse === undefined || passage.endVerse === undefined) {
    return versesForWholeChapter(passage.book, passage.startChapter);
  }
  if (passage.startChapter > passage.endChapter) throw new Error("invalid range");
  const result: BibleVerse[] = [];
  const seen = new Set<string>();
  for (let chapter = passage.startChapter; chapter <= passage.endChapter; chapter += 1) {
    const start = chapter === passage.startChapter ? passage.startVerse : 1;
    const end = chapter === passage.endChapter ? passage.endVerse : lastVerseNumber(passage.book, chapter);
    if (start > end) throw new Error("invalid range");
    for (let verseNumber = start; verseNumber <= end; verseNumber += 1) {
      const verse = verseMap.get(verseKey(passage.book.code, chapter, verseNumber));
      if (!verse) throw new Error("verse not found");
      const key = canonicalVerseKey(verse);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(verse);
    }
  }
  return result;
}

function versesForWholeChapter(book: BibleBook, chapter: number) {
  const verses = chapterMap.get(chapterKey(book.code, chapter));
  if (!verses?.length) throw new Error("chapter not found");
  return verses;
}

function lastVerseNumber(book: BibleBook, chapter: number) {
  const verses = versesForWholeChapter(book, chapter);
  return verses[verses.length - 1]?.endVerse || 0;
}

function serializeVerse(verse: BibleVerse): BibleVerseLineDTO {
  const book = bookByCode.get(verse.book);
  const bookName = book?.chineseName || verse.book;
  return {
    book: bookName,
    chapter: verse.chapter,
    verse: verse.verse,
    endVerse: verse.endVerse,
    reference: `${bookName} ${verse.chapter}:${verse.verse === verse.endVerse ? verse.verse : `${verse.verse}-${verse.endVerse}`}`,
    text: cleanVerseText(verse.text)
  };
}

function displayParsedReference(parsedReference: ParsedReference) {
  return parsedReference.passages.map(displayPassage).join("；");
}

function displayPassage(passage: PassageReference) {
  if (passage.startVerse === undefined || passage.endVerse === undefined) return `${passage.book.chineseName} 第${passage.startChapter}章`;
  if (passage.startChapter === passage.endChapter) {
    if (passage.startVerse === passage.endVerse) return `${passage.book.chineseName} ${passage.startChapter}:${passage.startVerse}`;
    return `${passage.book.chineseName} ${passage.startChapter}:${passage.startVerse}-${passage.endVerse}`;
  }
  return `${passage.book.chineseName} ${passage.startChapter}:${passage.startVerse}-${passage.endChapter}:${passage.endVerse}`;
}

function cleanVerseText(raw: string) {
  return raw.replace(/\u3000/g, "").trim();
}

function normalizeSearchText(raw: string) {
  return raw.toLocaleLowerCase();
}

function findTextMatches(text: string, terms: string[]): BibleTextMatchRangeDTO[] {
  const normalizedText = normalizeSearchText(text);
  const ranges: BibleTextMatchRangeDTO[] = [];
  for (const term of terms) {
    if (!term) continue;
    let cursor = 0;
    while (cursor <= normalizedText.length - term.length) {
      const start = normalizedText.indexOf(term, cursor);
      if (start < 0) break;
      ranges.push({ start, end: start + term.length });
      cursor = start + Math.max(1, term.length);
    }
  }
  ranges.sort((left, right) => left.start - right.start || left.end - right.end);
  return ranges.reduce<BibleTextMatchRangeDTO[]>((merged, range) => {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
    return merged;
  }, []);
}

function numberGroup(match: RegExpMatchArray, index: number) {
  return Number(match[index] || 0);
}

function optionalNumberGroup(match: RegExpMatchArray, index: number) {
  const value = match[index];
  return value ? Number(value) : undefined;
}

function assertRange(start?: number, end?: number) {
  if (start !== undefined && end !== undefined && start > end) throw new Error("invalid range");
}

function verseKey(book: string, chapter: number, verse: number) {
  return `${book}#${chapter}#${verse}`;
}

function chapterKey(book: string, chapter: number) {
  return `${book}#${chapter}`;
}

function canonicalVerseKey(verse: BibleVerse) {
  return `${verse.book}#${verse.chapter}#${verse.verse}#${verse.endVerse}`;
}

function compareBibleVerses(left: BibleVerse, right: BibleVerse) {
  return (bookOrder.get(left.book) ?? Number.MAX_SAFE_INTEGER) - (bookOrder.get(right.book) ?? Number.MAX_SAFE_INTEGER)
    || left.chapter - right.chapter
    || left.verse - right.verse
    || left.endVerse - right.endVerse;
}

function normalizeBook(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[.\-_]/g, "")
    .replace(/前書/g, "前书")
    .replace(/後書/g, "后书")
    .replace(/記/g, "记")
    .replace(/約/g, "约")
    .replace(/啟/g, "启")
    .replace(/詩/g, "诗")
    .replace(/陸/g, "陆")
    .replace(/創/g, "创");
}

function normalizeBookStart(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[._]/g, "")
    .replace(/前書/g, "前书")
    .replace(/後書/g, "后书")
    .replace(/記/g, "记")
    .replace(/約/g, "约")
    .replace(/啟/g, "启")
    .replace(/詩/g, "诗")
    .replace(/陸/g, "陆")
    .replace(/創/g, "创");
}
