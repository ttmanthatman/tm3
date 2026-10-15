export type ChannelMembershipScope = {
  id?: number;
  isDefault?: boolean;
  isPrivate: boolean;
  directKey?: string | null;
};

export type VirtualChannelCandidate = {
  username: string;
  config?: unknown;
};

export function channelNeedsExplicitMembership(channel: Pick<ChannelMembershipScope, "isPrivate" | "directKey">) {
  return channel.isPrivate || Boolean(channel.directKey);
}

export function channelNotificationAudienceWhere(
  channelId: number,
  channel: Pick<ChannelMembershipScope, "isPrivate" | "directKey">
) {
  return channelNeedsExplicitMembership(channel) ? { memberships: { some: { channelId } } } : {};
}

function configuredChannelIds(rawConfig: unknown) {
  if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) return [];
  const channels = (rawConfig as { invitedChannels?: unknown }).invitedChannels;
  return Array.isArray(channels) ? [...new Set(channels.map(Number).filter(Number.isFinite))] : [];
}

export function virtualCharacterConfigForChannel(rawConfig: unknown, channelId: number, invited: boolean) {
  const config = rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig) ? (rawConfig as Record<string, unknown>) : {};
  const channelIds = new Set(configuredChannelIds(config));
  if (invited) channelIds.add(channelId);
  else channelIds.delete(channelId);
  return { ...config, channels: [], invitedChannels: [...channelIds] };
}

export function virtualCharacterVisibleInChannel(channel: ChannelMembershipScope, character: VirtualChannelCandidate) {
  if (channel.isDefault && !channelNeedsExplicitMembership(channel)) return true;
  if (channel.id && configuredChannelIds(character.config).includes(channel.id)) return true;
  return Boolean(channel.directKey && channel.directKey.startsWith("virtual:") && channel.directKey.endsWith(`:${character.username}`));
}
