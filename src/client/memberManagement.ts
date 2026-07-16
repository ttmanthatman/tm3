export type ChannelMemberLike = {
  accountId?: number;
  characterId?: number;
  kind: string;
  role?: string;
  membershipRole?: string | null;
};

export function memberRoleLabel(member: ChannelMemberLike) {
  if (member.kind === "virtual") return "角色";
  if (member.role === "owner") return "创建者";
  if (member.role === "admin") return "管理员";
  return "";
}

export function canRemoveChannelMember(member: ChannelMemberLike, options: { canManage: boolean; currentAccountId?: number | null }) {
  if (member.kind === "virtual") return options.canManage && Boolean(member.characterId);
  const channelRole = member.membershipRole ?? member.role;
  return (
    options.canManage &&
    !!member.accountId &&
    member.accountId !== options.currentAccountId &&
    channelRole !== "owner" &&
    channelRole !== "admin"
  );
}
