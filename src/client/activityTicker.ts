import type { BibleReaderPresenceDTO, BookReaderPresenceDTO, FriendListenerDTO, MusicListenerDTO } from "@shared/types";

export type TypingActivity = { displayName: string };

export function activityTickerItems(
  bibleReaders: BibleReaderPresenceDTO[],
  bookReaders: BookReaderPresenceDTO[],
  musicListeners: MusicListenerDTO[],
  friendListeners: FriendListenerDTO[],
  typingActivities: TypingActivity[]
) {
  const typingNames = [...new Set(typingActivities.map((activity) => activity.displayName.trim()).filter(Boolean))];
  return [
    ...bibleReaders.map((reader) => `${reader.displayName}正在读${reader.bookName ? `《${reader.bookName}》` : "圣经"}`),
    ...bookReaders.map((reader) => `${reader.displayName}正在读《${reader.bookTitle}》`),
    ...musicListeners.map((listener) => `${listener.displayName}正在听《${listener.trackTitle}》`),
    ...friendListeners.map((listener) => `${listener.displayName}正在听良友节目《${listener.programTitle}》`),
    ...(typingNames.length ? [`${typingNames.join("、")}正在输入${typingNames.length === 1 ? "…" : ""}`] : [])
  ];
}
