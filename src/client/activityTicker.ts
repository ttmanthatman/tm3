import type { BibleReaderPresenceDTO, MusicListenerDTO } from "@shared/types";

export type TypingActivity = { displayName: string };

export function activityTickerItems(
  bibleReaders: BibleReaderPresenceDTO[],
  musicListeners: MusicListenerDTO[],
  typingActivities: TypingActivity[]
) {
  return [
    ...bibleReaders.map((reader) => `${reader.displayName}正在读${reader.bookName ? `《${reader.bookName}》` : "圣经"}`),
    ...musicListeners.map((listener) => `${listener.displayName}正在听《${listener.trackTitle}》`),
    ...typingActivities.map((activity) => `${activity.displayName}正在输入…`)
  ];
}
