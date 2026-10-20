import {
  LISTEN_PLAYLIST_ITEM_MAX,
  LISTEN_PLAYLIST_NOTE_MAX,
  LISTEN_PLAYLIST_REFERENCE_MAX,
  LISTEN_PLAYLIST_TRACK_TITLE_MAX,
  type ListenPlaylistItem,
  type ListenPlaylistPayload
} from "../../shared/listenPlaylist.js";
import { defaultBibleTranslationName, parseBibleTopicPassages } from "../bible/lookup.js";

export type ListenTrackResolver = (trackId: number) => Promise<{ id: number; title: string } | null>;

// 「/听」消息 payload 清洗：客户端只交引用串与歌曲 id，这里解析成定位字段并校验歌曲存在，
// 收信人拿到的是自包含、可直接喂给播放器的清单；任何一项无效都整条拒绝，不静默丢项。
export async function cleanListenPlaylistPayload(input: unknown, resolveTrack: ListenTrackResolver): Promise<ListenPlaylistPayload> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("播放列表无效");
  const raw = input as { items?: unknown; note?: unknown };
  if (!Array.isArray(raw.items) || !raw.items.length) throw new Error("请至少加入一段经文或一首歌");
  if (raw.items.length > LISTEN_PLAYLIST_ITEM_MAX) throw new Error(`播放列表最多 ${LISTEN_PLAYLIST_ITEM_MAX} 项`);
  const items: ListenPlaylistItem[] = [];
  for (const entry of raw.items) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("播放列表无效");
    const row = entry as { kind?: unknown; reference?: unknown; trackId?: unknown };
    if (row.kind === "track") {
      const trackId = Number(row.trackId);
      if (!Number.isInteger(trackId) || trackId <= 0) throw new Error("播放列表里的歌曲无效");
      const track = await resolveTrack(trackId);
      if (!track) throw new Error("播放列表里的歌曲不存在或已被删除");
      items.push({ kind: "track", trackId: track.id, title: track.title.slice(0, LISTEN_PLAYLIST_TRACK_TITLE_MAX) });
      continue;
    }
    if (row.kind !== "scripture" || typeof row.reference !== "string") throw new Error("播放列表无效");
    const reference = row.reference.trim().slice(0, LISTEN_PLAYLIST_REFERENCE_MAX);
    if (!reference) throw new Error("经文引用不能为空");
    let passages;
    try {
      passages = parseBibleTopicPassages(reference, LISTEN_PLAYLIST_ITEM_MAX);
    } catch {
      throw new Error(`无法识别经文「${reference}」`);
    }
    for (const passage of passages) {
      items.push({
        kind: "scripture",
        reference: passage.reference,
        bookCode: passage.bookCode,
        bookName: passage.bookName,
        startChapter: passage.startChapter,
        startVerse: passage.startVerse,
        endChapter: passage.endChapter,
        endVerse: passage.endVerse
      });
    }
    if (items.length > LISTEN_PLAYLIST_ITEM_MAX) throw new Error(`播放列表最多 ${LISTEN_PLAYLIST_ITEM_MAX} 项`);
  }
  const note = typeof raw.note === "string" ? raw.note.trim().slice(0, LISTEN_PLAYLIST_NOTE_MAX) : "";
  return {
    kind: "listen_playlist",
    items,
    translation: defaultBibleTranslationName(),
    ...(note ? { note } : {})
  };
}
