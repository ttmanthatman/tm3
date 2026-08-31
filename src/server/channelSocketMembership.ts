type ChannelSocketLike = {
  leave: (room: string) => unknown;
};

export function leaveAccountSocketsFromChannel(
  socketIds: Iterable<string> | undefined,
  resolveSocket: (socketId: string) => ChannelSocketLike | undefined,
  channelId: number
) {
  for (const socketId of socketIds ?? []) resolveSocket(socketId)?.leave(`ch:${channelId}`);
}
