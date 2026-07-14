export function canReadMusicScore(channelKind: string, canAccessSourceChannel: boolean) {
  return channelKind === "music" || canAccessSourceChannel;
}
