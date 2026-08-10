import type { ChannelDTO, MessageDTO } from "@shared/types";

// Broadcast DTOs are serialized from the acting account's view, so viewer-
// specific fields (listen state, own reactions, own prayer mark) must keep
// the receiving client's values when an update is applied.
export function mergeMessageUpdate(existing: MessageDTO | undefined, incoming: MessageDTO): MessageDTO {
  if (!existing) return incoming;
  if (existing.voiceListened !== undefined) incoming.voiceListened = existing.voiceListened;
  if (existing.reactions && incoming.reactions) {
    incoming.reactions.currentUserLiked = existing.reactions.currentUserLiked;
    incoming.reactions.currentUserFavorited = existing.reactions.currentUserFavorited;
  }
  if (incoming.type === "prayer") {
    const existingPayload = existing.payload as { currentUserPrayed?: boolean } | undefined;
    const incomingPayload = incoming.payload as { currentUserPrayed?: boolean } | undefined;
    if (existingPayload && incomingPayload && existingPayload.currentUserPrayed !== undefined) {
      incomingPayload.currentUserPrayed = existingPayload.currentUserPrayed;
    }
  }
  return incoming;
}

// channel:updated payloads carry the acting account's permission flags and
// dismissal state, and single-channel DTOs have no lastMessageId; merge the
// neutral fields and keep the receiving client's own values for the rest.
export function mergeChannelUpdate(existing: ChannelDTO, incoming: ChannelDTO): ChannelDTO {
  const { canManage, canWrite, canPin, lastMessageId, pinned } = existing;
  return Object.assign(existing, incoming, { canManage, canWrite, canPin, lastMessageId, pinned });
}
