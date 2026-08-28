import type { SermonInvitedEvent, SermonPresentationSummaryDTO } from "@shared/types";

export type WatchablePresentation = {
  summary: SermonPresentationSummaryDTO;
  /** 本人正在观看该演示。 */
  watching: boolean;
  /** 已入座其他演示：直接加入会被 seated-elsewhere 拒绝，需先离开当前演示。 */
  blocked: boolean;
};

/** 未被静音的邀请（静音仅影响横幅弹出，不动邀请本身的有效性）。 */
export function visibleSermonInvites(invites: SermonInvitedEvent[], mutedIds: Set<number>): SermonInvitedEvent[] {
  return invites.filter((invite) => !mutedIds.has(invite.presenterId));
}

/**
 * 可观看演示列表：受邀的小组演示 + 进行中的集会演示（排除已静音与本人自己的演示）。
 * 集会演示恒可观看，未开始展示（active:false）时不列入；小组演示需当前持有有效邀请。
 */
export function computeWatchablePresentations(options: {
  directory: SermonPresentationSummaryDTO[];
  invites: SermonInvitedEvent[];
  mutedIds: Set<number>;
  joinedPresentationId: number | null;
  ownAccountId: number | null;
}): WatchablePresentation[] {
  const { directory, invites, mutedIds, joinedPresentationId, ownAccountId } = options;
  const invitedIds = new Set(visibleSermonInvites(invites, mutedIds).map((invite) => invite.presenterId));
  return directory
    .filter((summary) => summary.presenterId !== ownAccountId)
    .filter((summary) => (summary.scope === "assembly" ? summary.active : invitedIds.has(summary.presenterId)))
    .map((summary) => ({
      summary,
      watching: summary.presenterId === joinedPresentationId,
      blocked: joinedPresentationId !== null && summary.presenterId !== joinedPresentationId
    }));
}
