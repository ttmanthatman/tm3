import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Prisma, PrismaClient } from "@prisma/client";
import { unzipArchive, type ZipArchiveEntry } from "../zipArchive.js";
import { BIBLE_BOOK_COUNT, BIBLE_CHAPTER_COUNT, bibleBookChapterCount, isBibleBookCode } from "../../shared/bibleBooks.js";
import {
  BIBLE_AUDIO_VERSION_ID_PATTERN,
  parseBibleAudioVerseTimestamps,
  type BibleAudioAdminVersion,
  type BibleAudioVerseTimestamp,
  type BibleAudioVersionInfo
} from "../../shared/bibleAudio.js";

// 有声圣经卷包导入：校验 bundle.json 与音频文件（格式契约见 docs/audio-bible-integration-handoff.md §2），
// 全部通过后才落盘并写库；任何一项不符整包拒绝。

export class BibleAudioBundleRejectedError extends Error {
  statusCode = 400;
}

export type ParsedBibleAudioChapter = {
  chapter: number;
  fileName: string;
  bytes: number;
  md5: string;
  durationMs: number;
  verses: BibleAudioVerseTimestamp[];
  data: Buffer;
};

export type ParsedBibleAudioBundle = {
  versionId: string;
  name: string;
  language: string;
  dialect: string | null;
  style: string | null;
  translation: string;
  copyright: string;
  book: { code: string; nameZh: string; chapterCount: number };
  chapters: ParsedBibleAudioChapter[];
};

const BUNDLE_MANIFEST_NAME = "bundle.json";
const CHAPTER_FILE_PATTERN = /^[A-Z0-9]{3}_\d{3}\.mp3$/;

function reject(message: string): never {
  throw new BibleAudioBundleRejectedError(message);
}

function readString(row: Record<string, unknown>, key: string, max: number, required = true) {
  const value = row[key];
  if (value === undefined || value === null || value === "") {
    if (required) reject(`bundle.json 缺少 ${key}`);
    return null;
  }
  if (typeof value !== "string") reject(`bundle.json 的 ${key} 必须是字符串`);
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) reject(`bundle.json 的 ${key} 不能为空`);
    return null;
  }
  if (trimmed.length > max) reject(`bundle.json 的 ${key} 超过 ${max} 字`);
  return trimmed;
}

function readPositiveInt(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) reject(`${label} 必须是正整数`);
  return number;
}

function chapterFileName(bookCode: string, chapter: number) {
  return `${bookCode}_${String(chapter).padStart(3, "0")}.mp3`;
}

export function parseBibleAudioBundle(entries: ZipArchiveEntry[]): ParsedBibleAudioBundle {
  const files = new Map<string, Buffer>();
  for (const entry of entries) files.set(entry.name.replace(/^\/+/, ""), entry.data);
  const manifestBuffer = files.get(BUNDLE_MANIFEST_NAME);
  if (!manifestBuffer) reject("资源包缺少 bundle.json");
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestBuffer.toString("utf8"));
  } catch {
    reject("bundle.json 不是有效的 JSON");
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) reject("bundle.json 结构无效");
  const row = manifest as Record<string, unknown>;
  if (row.formatVersion !== 1) reject("不支持的资源包格式版本，仅支持 formatVersion 1");
  const versionId = readString(row, "versionId", 40) as string;
  if (!BIBLE_AUDIO_VERSION_ID_PATTERN.test(versionId)) reject("versionId 只能包含小写字母、数字和连字符（3–40 位）");
  const name = readString(row, "name", 80) as string;
  const language = readString(row, "language", 16) as string;
  const dialect = readString(row, "dialect", 16, false);
  const style = readString(row, "style", 24, false);
  const translation = readString(row, "translation", 30) as string;
  const copyright = readString(row, "copyright", 20000) as string;

  const bookRow = row.book;
  if (!bookRow || typeof bookRow !== "object" || Array.isArray(bookRow)) reject("bundle.json 缺少 book");
  const book = bookRow as Record<string, unknown>;
  const bookCode = readString(book, "code", 3) as string;
  if (!isBibleBookCode(bookCode)) reject(`未知的书卷码 ${bookCode}`);
  const nameZh = readString(book, "nameZh", 40) as string;
  const chapterCount = readPositiveInt(book.chapterCount, "book.chapterCount");
  if (chapterCount !== bibleBookChapterCount(bookCode)) reject(`${nameZh} 应有 ${bibleBookChapterCount(bookCode)} 章，bundle.json 声明了 ${chapterCount} 章`);

  if (!Array.isArray(row.chapters)) reject("bundle.json 缺少 chapters");
  if (row.chapters.length !== chapterCount) reject(`${nameZh} 应包含 ${chapterCount} 章，资源包只有 ${row.chapters.length} 章`);
  const seen = new Set<number>();
  const chapters: ParsedBibleAudioChapter[] = [];
  for (const item of row.chapters) {
    if (!item || typeof item !== "object" || Array.isArray(item)) reject("chapters 条目结构无效");
    const chapterRow = item as Record<string, unknown>;
    if (chapterRow.book !== bookCode) reject(`章节条目的 book 与 ${bookCode} 不一致`);
    const chapter = readPositiveInt(chapterRow.chapter, "章号");
    if (chapter > chapterCount) reject(`章号 ${chapter} 超出 ${nameZh} 的 ${chapterCount} 章`);
    if (seen.has(chapter)) reject(`章号 ${chapter} 重复`);
    seen.add(chapter);
    const fileName = chapterFileName(bookCode, chapter);
    const expectedPath = `audio/${bookCode}/${fileName}`;
    if (chapterRow.file !== expectedPath) reject(`第 ${chapter} 章的文件路径应为 ${expectedPath}`);
    const data = files.get(expectedPath);
    if (!data) reject(`资源包缺少 ${expectedPath}`);
    const bytes = readPositiveInt(chapterRow.bytes, `第 ${chapter} 章的 bytes`);
    if (bytes !== data.length) reject(`${fileName} 的大小与 bundle.json 不一致`);
    const md5 = typeof chapterRow.md5 === "string" ? chapterRow.md5.toLowerCase() : "";
    if (!/^[0-9a-f]{32}$/.test(md5)) reject(`第 ${chapter} 章缺少有效的 md5`);
    if (crypto.createHash("md5").update(data).digest("hex") !== md5) reject(`${fileName} 的 md5 校验失败`);
    const durationMs = readPositiveInt(chapterRow.durationMs, `第 ${chapter} 章的 durationMs`);
    const verses = parseBibleAudioVerseTimestamps(chapterRow.verses);
    if (!verses || !verses.length) reject(`第 ${chapter} 章的逐节时间戳无效`);
    if (!CHAPTER_FILE_PATTERN.test(fileName)) reject(`${fileName} 文件名无效`);
    chapters.push({ chapter, fileName, bytes, md5, durationMs, verses, data });
  }
  chapters.sort((left, right) => left.chapter - right.chapter);
  return { versionId, name, language, dialect, style, translation, copyright, book: { code: bookCode, nameZh, chapterCount }, chapters };
}

export type BibleAudioVersionRow = {
  id: number;
  versionId: string;
  name: string;
  language: string;
  dialect: string | null;
  style: string | null;
  translation: string;
  copyright: string;
  bookCount: number;
  chapterCount: number;
  totalBytes: bigint | number;
  completed: boolean;
};

export function bibleAudioVersionInfo(row: BibleAudioVersionRow): BibleAudioVersionInfo {
  return {
    versionId: row.versionId,
    name: row.name,
    language: row.language,
    dialect: row.dialect,
    style: row.style,
    translation: row.translation,
    copyright: row.copyright,
    bookCount: row.bookCount,
    chapterCount: row.chapterCount,
    totalBytes: Number(row.totalBytes),
    completed: row.completed
  };
}

export function bibleAudioVersionDir(bibleAudioDir: string, versionId: string) {
  return path.join(bibleAudioDir, path.basename(versionId));
}

export function bibleAudioChapterPath(bibleAudioDir: string, versionId: string, bookCode: string, fileName: string) {
  return path.join(bibleAudioVersionDir(bibleAudioDir, versionId), "audio", path.basename(bookCode), path.basename(fileName));
}

type ImportDeps = {
  prisma: PrismaClient;
  bibleAudioDir: string;
};

export type BibleAudioImportResult = {
  version: BibleAudioAdminVersion;
  book: { code: string; nameZh: string; chapterCount: number; replaced: boolean };
};

async function refreshVersionAggregates(prisma: PrismaClient, versionId: number) {
  const rows = await prisma.bibleAudioChapter.findMany({ where: { versionId }, select: { bookCode: true, bytes: true } });
  const books = new Set(rows.map((row) => row.bookCode));
  const totalBytes = rows.reduce((total, row) => total + BigInt(row.bytes), 0n);
  const completed = books.size === BIBLE_BOOK_COUNT && rows.length === BIBLE_CHAPTER_COUNT;
  const version = await prisma.bibleAudioVersion.update({
    where: { id: versionId },
    data: { bookCount: books.size, chapterCount: rows.length, totalBytes, completed }
  });
  return { version, books: [...books] };
}

export async function bibleAudioAdminVersions(prisma: PrismaClient): Promise<BibleAudioAdminVersion[]> {
  const versions = await prisma.bibleAudioVersion.findMany({ orderBy: { createdAt: "asc" } });
  const result: BibleAudioAdminVersion[] = [];
  for (const version of versions) {
    const rows = await prisma.bibleAudioChapter.findMany({ where: { versionId: version.id }, select: { bookCode: true }, distinct: ["bookCode"] });
    result.push({ ...bibleAudioVersionInfo(version), books: rows.map((row) => row.bookCode) });
  }
  return result;
}

/** 校验并导入一个卷包：先把新文件写到旁路临时名再原子替换，再在事务里替换该卷章节行。 */
export async function importBibleAudioBundle(deps: ImportDeps, archive: Buffer): Promise<BibleAudioImportResult> {
  let entries: ZipArchiveEntry[];
  try {
    entries = unzipArchive(archive);
  } catch {
    reject("资源包不是有效的 ZIP 文件");
  }
  const bundle = parseBibleAudioBundle(entries);
  const bookDir = path.join(bibleAudioVersionDir(deps.bibleAudioDir, bundle.versionId), "audio", bundle.book.code);
  fs.mkdirSync(bookDir, { recursive: true });
  const token = crypto.randomUUID();
  const written: string[] = [];
  try {
    for (const chapter of bundle.chapters) {
      const tempPath = path.join(bookDir, `${chapter.fileName}.${token}.tmp`);
      fs.writeFileSync(tempPath, chapter.data);
      written.push(tempPath);
    }
    for (const chapter of bundle.chapters) {
      fs.renameSync(path.join(bookDir, `${chapter.fileName}.${token}.tmp`), path.join(bookDir, chapter.fileName));
    }
  } catch (error) {
    for (const tempPath of written) fs.rmSync(tempPath, { force: true });
    throw error;
  }
  const keep = new Set(bundle.chapters.map((chapter) => chapter.fileName));
  for (const name of fs.readdirSync(bookDir)) {
    if (!keep.has(name)) fs.rmSync(path.join(bookDir, name), { force: true });
  }

  const { versionRowId, replaced } = await deps.prisma.$transaction(async (transaction) => {
    const version = await transaction.bibleAudioVersion.upsert({
      where: { versionId: bundle.versionId },
      create: {
        versionId: bundle.versionId,
        name: bundle.name,
        language: bundle.language,
        dialect: bundle.dialect,
        style: bundle.style,
        translation: bundle.translation,
        copyright: bundle.copyright
      },
      update: {
        name: bundle.name,
        language: bundle.language,
        dialect: bundle.dialect,
        style: bundle.style,
        translation: bundle.translation,
        copyright: bundle.copyright
      }
    });
    const removed = await transaction.bibleAudioChapter.deleteMany({ where: { versionId: version.id, bookCode: bundle.book.code } });
    await transaction.bibleAudioChapter.createMany({
      data: bundle.chapters.map((chapter) => ({
        versionId: version.id,
        bookCode: bundle.book.code,
        chapter: chapter.chapter,
        fileName: chapter.fileName,
        bytes: BigInt(chapter.bytes),
        md5: chapter.md5,
        durationMs: chapter.durationMs,
        verses: chapter.verses as unknown as Prisma.InputJsonValue
      }))
    });
    return { versionRowId: version.id, replaced: removed.count > 0 };
  });
  const { version, books } = await refreshVersionAggregates(deps.prisma, versionRowId);
  return {
    version: { ...bibleAudioVersionInfo(version), books },
    book: { code: bundle.book.code, nameZh: bundle.book.nameZh, chapterCount: bundle.chapters.length, replaced }
  };
}

export async function deleteBibleAudioVersion(deps: ImportDeps, versionId: string) {
  const version = await deps.prisma.bibleAudioVersion.findUnique({ where: { versionId } });
  if (!version) return false;
  await deps.prisma.bibleAudioVersion.delete({ where: { id: version.id } });
  fs.rmSync(bibleAudioVersionDir(deps.bibleAudioDir, versionId), { recursive: true, force: true });
  return true;
}
