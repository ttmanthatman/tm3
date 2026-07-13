export type ChannelDraft = {
  name: string;
  description: string;
  isPrivate: boolean;
};

export type EditableChannelLike = {
  canManage?: boolean;
  kind?: string;
  isPrivate?: boolean;
};

export function createChannelDraft(): ChannelDraft {
  return { name: "", description: "", isPrivate: true };
}

export function canEditChannel(channel?: EditableChannelLike | null) {
  return !!channel?.canManage && channel.kind !== "aiLounge" && channel.kind !== "music";
}

export function canManageChannelMembers(channel?: EditableChannelLike | null) {
  return canEditChannel(channel) && !!channel?.isPrivate;
}

export function normalizeChannelDraft(draft: ChannelDraft) {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    isPrivate: !!draft.isPrivate
  };
}

export function canSubmitChannelDraft(draft: ChannelDraft, busy = false) {
  return !busy && !!normalizeChannelDraft(draft).name;
}
