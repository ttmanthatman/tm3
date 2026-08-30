export type BibleBookSectionKey =
  | "pentateuch"
  | "history"
  | "wisdom"
  | "major-prophets"
  | "minor-prophets"
  | "gospels"
  | "acts"
  | "epistles"
  | "revelation";

export type BibleBookSection = {
  key: BibleBookSectionKey;
  label: string;
  color: string;
  bookCodes: readonly string[];
};

export const BIBLE_BOOK_SECTIONS: readonly BibleBookSection[] = [
  { key: "pentateuch", label: "摩西五经", color: "#8a5a16", bookCodes: ["GEN", "EXO", "LEV", "NUM", "DEU"] },
  { key: "history", label: "历史书", color: "#974735", bookCodes: ["JOS", "JDG", "RUT", "1SA", "2SA", "1KI", "2KI", "1CH", "2CH", "EZR", "NEH", "EST"] },
  { key: "wisdom", label: "智慧书", color: "#74506f", bookCodes: ["JOB", "PSA", "PRO", "ECC", "SNG"] },
  { key: "major-prophets", label: "大先知书", color: "#555487", bookCodes: ["ISA", "JER", "LAM", "EZK", "DAN"] },
  { key: "minor-prophets", label: "小先知书", color: "#3f7189", bookCodes: ["HOS", "JOL", "AMO", "OBA", "JON", "MIC", "NAM", "HAB", "ZEP", "HAG", "ZEC", "MAL"] },
  { key: "gospels", label: "福音书", color: "#276750", bookCodes: ["MAT", "MRK", "LUK", "JHN"] },
  { key: "acts", label: "使徒行传", color: "#176a70", bookCodes: ["ACT"] },
  { key: "epistles", label: "书信", color: "#345d8b", bookCodes: ["ROM", "1CO", "2CO", "GAL", "EPH", "PHP", "COL", "1TH", "2TH", "1TI", "2TI", "TIT", "PHM", "HEB", "JAS", "1PE", "2PE", "1JN", "2JN", "3JN", "JUD"] },
  { key: "revelation", label: "启示录", color: "#8d3f5d", bookCodes: ["REV"] }
];

const bibleBookSectionByCode = new Map(
  BIBLE_BOOK_SECTIONS.flatMap((section) => section.bookCodes.map((bookCode) => [bookCode, section] as const))
);

export function bibleBookSection(bookCode: string) {
  return bibleBookSectionByCode.get(bookCode.trim().toUpperCase()) || null;
}
