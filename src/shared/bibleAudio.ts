// 有声圣经（华语有声戏剧圣经）共享契约。
// 资源包格式与接口见 docs/audio-bible-integration-handoff.md §2/§4。

export const BIBLE_AUDIO_VERSION_ID_PATTERN = /^[a-z0-9-]{3,40}$/;

/** 逐节时间戳；verse 0 表示章题/引子朗读 */
export type BibleAudioVerseTimestamp = {
  verse: number;
  startMs: number;
  endMs: number;
};

export type BibleAudioChapterIndex = {
  book: string;
  chapter: number;
  durationMs: number;
  verses: BibleAudioVerseTimestamp[];
};

export type BibleAudioVersionInfo = {
  versionId: string;
  name: string;
  language: string;
  dialect: string | null;
  style: string | null;
  translation: string;
  copyright: string;
  bookCount: number;
  chapterCount: number;
  totalBytes: number;
  completed: boolean;
};

/** manifest 里每个版本的完整章节索引（含逐节时间戳） */
export type BibleAudioVersionManifest = BibleAudioVersionInfo & {
  chapters: BibleAudioChapterIndex[];
};

export type BibleAudioManifest = {
  enabled: boolean;
  defaultVersionId: string | null;
  versions: BibleAudioVersionManifest[];
};

/** 管理面板用的版本概览（含已上传卷码，不带时间戳明细） */
export type BibleAudioAdminVersion = BibleAudioVersionInfo & {
  books: string[];
};

export function parseBibleAudioVerseTimestamps(value: unknown): BibleAudioVerseTimestamp[] | null {
  if (!Array.isArray(value)) return null;
  const verses: BibleAudioVerseTimestamp[] = [];
  let previousEnd = -1;
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    const verse = Number(row.verse);
    const startMs = Number(row.startMs);
    const endMs = Number(row.endMs);
    if (!Number.isInteger(verse) || verse < 0 || verse > 200) return null;
    if (!Number.isInteger(startMs) || !Number.isInteger(endMs) || startMs < 0 || startMs >= endMs) return null;
    if (startMs < previousEnd) return null;
    previousEnd = endMs;
    verses.push({ verse, startMs, endMs });
  }
  return verses;
}
