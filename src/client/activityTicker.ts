import type { BibleListenerDTO, BibleReaderPresenceDTO, BookReaderPresenceDTO, FriendListenerDTO, MusicListenerDTO } from "@shared/types";

export type TypingActivity = { displayName: string };

export type ActivityTickerSources = {
  bibleReaders: BibleReaderPresenceDTO[];
  bibleListeners: BibleListenerDTO[];
  bookReaders: BookReaderPresenceDTO[];
  musicListeners: MusicListenerDTO[];
  friendListeners: FriendListenerDTO[];
  typingActivities: TypingActivity[];
};

export function activityTickerItems(sources: ActivityTickerSources) {
  const typingNames = [...new Set(sources.typingActivities.map((activity) => activity.displayName.trim()).filter(Boolean))];
  return [
    ...sources.bibleReaders.map((reader) => `${reader.displayName}正在读${reader.bookName ? `《${reader.bookName}》` : "圣经"}`),
    ...sources.bibleListeners.map((listener) => `${listener.displayName}正在听圣经《${listener.bookName}》${listener.chapter}章`),
    ...sources.bookReaders.map((reader) => `${reader.displayName}正在读《${reader.bookTitle}》`),
    ...sources.musicListeners.map((listener) => `${listener.displayName}正在听《${listener.trackTitle}》`),
    ...sources.friendListeners.map((listener) => `${listener.displayName}正在听良友节目《${listener.programTitle}》`),
    ...(typingNames.length ? [`${typingNames.join("、")}正在输入${typingNames.length === 1 ? "…" : ""}`] : [])
  ];
}
