import type { BibleReaderPresenceDTO, FriendListenerDTO, MusicListenerDTO } from "@shared/types";

export type TypingActivity = { displayName: string };

export function advanceActivityTickerPosition(
  position: number,
  elapsedMs: number,
  contentWidth: number,
  viewportWidth: number,
  speedPxPerSecond = 36
) {
  const next = position - Math.max(0, elapsedMs) * speedPxPerSecond / 1000;
  return next <= -Math.max(0, contentWidth) ? Math.max(0, viewportWidth) : next;
}

export function activityTickerItems(
  bibleReaders: BibleReaderPresenceDTO[],
  musicListeners: MusicListenerDTO[],
  friendListeners: FriendListenerDTO[],
  typingActivities: TypingActivity[]
) {
  const typingNames = [...new Set(typingActivities.map((activity) => activity.displayName.trim()).filter(Boolean))];
  return [
    ...bibleReaders.map((reader) => `${reader.displayName}正在读${reader.bookName ? `《${reader.bookName}》` : "圣经"}`),
    ...musicListeners.map((listener) => `${listener.displayName}正在听《${listener.trackTitle}》`),
    ...friendListeners.map((listener) => `${listener.displayName}正在听良友节目《${listener.programTitle}》`),
    ...(typingNames.length ? [`${typingNames.join("、")}正在输入${typingNames.length === 1 ? "…" : ""}`] : [])
  ];
}
