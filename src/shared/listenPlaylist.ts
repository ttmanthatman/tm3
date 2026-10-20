export const LISTEN_PLAYLIST_ITEM_MAX = 50;
export const LISTEN_PLAYLIST_NOTE_MAX = 300;
export const LISTEN_PLAYLIST_TRACK_TITLE_MAX = 200;
export const LISTEN_PLAYLIST_REFERENCE_MAX = 200;

/** 「/听」消息里的一段经文：已由服务端解析成定位字段，收信人无需再查经即可播放。 */
export type ListenScriptureItem = {
  kind: "scripture";
  reference: string;
  bookCode: string;
  bookName: string;
  startChapter: number;
  startVerse: number;
  endChapter: number;
  endVerse: number;
};

export type ListenTrackItem = {
  kind: "track";
  trackId: number;
  title: string;
};

export type ListenPlaylistItem = ListenScriptureItem | ListenTrackItem;

export type ListenPlaylistPayload = {
  kind: "listen_playlist";
  items: ListenPlaylistItem[];
  translation: string;
  note?: string;
};

/** 客户端发送时的松散形态：经文只给引用串，歌曲只给 id，由服务端解析与校验。 */
export type ListenPlaylistDraftItem = { kind: "scripture"; reference: string } | { kind: "track"; trackId: number };

export type ListenPlaylistDraft = {
  kind: "listen_playlist";
  items: ListenPlaylistDraftItem[];
  note?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function positiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function nonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function listenPlaylistPayload(value: unknown): ListenPlaylistPayload | null {
  if (!isRecord(value) || value.kind !== "listen_playlist" || !Array.isArray(value.items)) return null;
  if (typeof value.translation !== "string") return null;
  const items: ListenPlaylistItem[] = [];
  for (const entry of value.items) {
    if (!isRecord(entry)) return null;
    if (entry.kind === "track") {
      if (!positiveInt(entry.trackId) || typeof entry.title !== "string") return null;
      items.push({ kind: "track", trackId: entry.trackId, title: entry.title });
      continue;
    }
    if (entry.kind !== "scripture") return null;
    if (
      typeof entry.reference !== "string" ||
      typeof entry.bookCode !== "string" ||
      typeof entry.bookName !== "string" ||
      !positiveInt(entry.startChapter) ||
      !positiveInt(entry.endChapter) ||
      !nonNegativeInt(entry.startVerse) ||
      !positiveInt(entry.endVerse)
    ) return null;
    items.push({
      kind: "scripture",
      reference: entry.reference,
      bookCode: entry.bookCode,
      bookName: entry.bookName,
      startChapter: entry.startChapter,
      startVerse: entry.startVerse,
      endChapter: entry.endChapter,
      endVerse: entry.endVerse
    });
  }
  if (!items.length || items.length > LISTEN_PLAYLIST_ITEM_MAX) return null;
  const note = typeof value.note === "string" && value.note.trim() ? value.note.trim().slice(0, LISTEN_PLAYLIST_NOTE_MAX) : undefined;
  return { kind: "listen_playlist", items, translation: value.translation, ...(note ? { note } : {}) };
}

/** 内容摘要只需要每项的显示文字，客户端草稿（未解析的引用串）与服务端已解析清单都适用 */
export type ListenPlaylistLabelItem = { kind: "scripture"; reference: string } | { kind: "track"; title: string };

export function listenPlaylistItemLabel(item: ListenPlaylistLabelItem) {
  return item.kind === "scripture" ? item.reference : item.title;
}

export function listenPlaylistCounts(items: ListenPlaylistLabelItem[]) {
  let scriptures = 0;
  let tracks = 0;
  for (const item of items) {
    if (item.kind === "scripture") scriptures += 1;
    else tracks += 1;
  }
  return { scriptures, tracks };
}

export function listenPlaylistCountLabel(items: ListenPlaylistLabelItem[]) {
  const { scriptures, tracks } = listenPlaylistCounts(items);
  return [scriptures ? `${scriptures} 段经文` : "", tracks ? `${tracks} 首歌` : ""].filter(Boolean).join(" · ");
}

/** 消息正文（通知、回复预览、搜索用）：「一起听：诗篇 23:1-6 · ♪奇异恩典 · 约翰福音 3:16」 */
export function listenPlaylistContent(items: ListenPlaylistLabelItem[], note?: string) {
  const labels = items.map((item) => (item.kind === "track" ? `♪${item.title}` : item.reference));
  const summary = `一起听：${labels.join(" · ")}`;
  return note?.trim() ? `${summary}\n${note.trim()}` : summary;
}
