import type { ChannelDTO } from "@shared/types";

export function orderChannels(channels: ChannelDTO[]) {
  return [...channels].sort((left, right) => {
    if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1;
    const newestDifference = (right.lastMessageId ?? 0) - (left.lastMessageId ?? 0);
    return newestDifference || left.id - right.id;
  });
}

export function noteChannelMessage(channels: ChannelDTO[], channelId: number, messageId: number) {
  const channel = channels.find((row) => row.id === channelId);
  if (!channel || messageId <= (channel.lastMessageId ?? 0)) return channels;
  channel.lastMessageId = messageId;
  return orderChannels(channels);
}
