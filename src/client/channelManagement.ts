export type ChannelDraft = {
  name: string;
  description: string;
  isPrivate: boolean;
  listColor: string;
  useListColor: boolean;
};

export type EditableChannelLike = {
  canManage?: boolean;
  kind?: string;
  isPrivate?: boolean;
  isDefault?: boolean;
  directKey?: string | null;
};

export function createChannelDraft(): ChannelDraft {
  return { name: "", description: "", isPrivate: true, listColor: "#e8f4ec", useListColor: false };
}

export function canEditChannel(channel?: EditableChannelLike | null) {
  return !!channel?.canManage && channel.kind !== "aiLounge" && channel.kind !== "music";
}

export function canManageChannelMembers(channel?: EditableChannelLike | null) {
  return canEditChannel(channel) && !!channel?.isPrivate;
}

export function canLeaveChannel(channel?: EditableChannelLike | null) {
  return (
    channel?.kind === "standard" &&
    !!channel.isPrivate &&
    !channel.isDefault &&
    !channel.directKey
  );
}

export function canOpenChannelSettings(channel?: EditableChannelLike | null) {
  return canEditChannel(channel) || canLeaveChannel(channel);
}

export function normalizeChannelDraft(draft: ChannelDraft) {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    isPrivate: !!draft.isPrivate,
    listColor: draft.useListColor && /^#[0-9a-f]{6}$/i.test(draft.listColor) ? draft.listColor.toLowerCase() : null
  };
}

export function canSubmitChannelDraft(draft: ChannelDraft, busy = false) {
  return !busy && !!normalizeChannelDraft(draft).name;
}
