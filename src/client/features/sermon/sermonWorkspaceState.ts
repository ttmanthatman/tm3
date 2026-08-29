import type {
  SermonDisplayDTO,
  SermonPlanDTO,
  SermonPresentationSummaryDTO,
  SermonQueueItem
} from "@shared/types";

/** 入口只展示本人以外、当前账号确有观看许可的进行中演示。 */
export function permittedSermonPresentations(
  directory: SermonPresentationSummaryDTO[],
  accountId: number | null
) {
  return directory.filter(
    (entry) =>
      entry.presenterId !== accountId &&
      entry.active &&
      (entry.scope === "assembly" || (accountId !== null && entry.invitedAccountIds.includes(accountId)))
  );
}

export function allSermonCandidatesSelected(candidateIds: number[], selectedIds: number[]) {
  if (!candidateIds.length) return false;
  const selected = new Set(selectedIds);
  return candidateIds.every((id) => selected.has(id));
}

/** 尚未展示时把队列首项作为即将展示页；展示中则取紧随当前页的条目。 */
export function nextSermonQueueItem(queue: SermonQueueItem[], currentItemId: string | null) {
  if (!queue.length) return null;
  if (currentItemId === null) return queue[0] ?? null;
  const currentIndex = queue.findIndex((item) => item.id === currentItemId);
  if (currentIndex < 0) return null;
  return queue[currentIndex + 1] ?? null;
}

function planContentKey(queue: SermonQueueItem[], display: SermonDisplayDTO) {
  return JSON.stringify({ queue, display });
}

/** 返回与当前队列及显示设置完全一致、且更新时间最新的保存方案。 */
export function matchingSermonPlan(
  plans: SermonPlanDTO[],
  queue: SermonQueueItem[],
  display: SermonDisplayDTO
) {
  const currentKey = planContentKey(queue, display);
  let matching: SermonPlanDTO | null = null;
  for (const plan of plans) {
    if (planContentKey(plan.queue, plan.display) !== currentKey) continue;
    if (!matching || plan.updatedAt > matching.updatedAt) matching = plan;
  }
  return matching;
}
