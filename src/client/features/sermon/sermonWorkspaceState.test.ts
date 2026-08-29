import assert from "node:assert/strict";
import test from "node:test";
import type { SermonDisplayDTO, SermonPlanDTO, SermonPresentationSummaryDTO, SermonQueueItem } from "../../../shared/types.js";
import {
  allSermonCandidatesSelected,
  matchingSermonPlan,
  nextSermonQueueItem,
  permittedSermonPresentations
} from "./sermonWorkspaceState.js";

const display: SermonDisplayDTO = {
  fontFamily: "songti",
  fontScale: 1,
  lineHeight: 1.6,
  marginPct: 4,
  background: "gradient"
};

function item(id: string, source = id): SermonQueueItem {
  return {
    id,
    kind: "text",
    reference: source,
    normalizedReference: source,
    verses: [],
    annotations: [],
    content: source,
    source
  };
}

function summary(presenterId: number, overrides: Partial<SermonPresentationSummaryDTO> = {}): SermonPresentationSummaryDTO {
  return {
    presenterId,
    presenterName: `讲道者${presenterId}`,
    scope: "group",
    active: true,
    audienceCount: 0,
    invitedAccountIds: [],
    preview: null,
    ...overrides
  };
}

test("入口只保留本人之外、当前账号获准观看的进行中讲道台", () => {
  assert.deepEqual(
    permittedSermonPresentations(
      [
        summary(7, { scope: "assembly" }),
        summary(8, { active: false, scope: "assembly" }),
        summary(9, { invitedAccountIds: [7] }),
        summary(10),
        summary(11, { scope: "assembly" })
      ],
      7
    ).map((entry) => entry.presenterId),
    [9, 11]
  );
  assert.deepEqual(permittedSermonPresentations([summary(9)], 7), [], "没有获准观看的他人讲道台时应直接进入本人讲道台");
});

test("邀请全选状态只在候选人非空且全部被选中时成立", () => {
  assert.equal(allSermonCandidatesSelected([], []), false);
  assert.equal(allSermonCandidatesSelected([2, 3], [2]), false);
  assert.equal(allSermonCandidatesSelected([2, 3], [3, 2, 99]), true);
});

test("下一页取当前条目的后一项，尚未展示时取队列第一项，末页后为空", () => {
  const queue = [item("a"), item("b"), item("c")];
  assert.equal(nextSermonQueueItem(queue, null)?.id, "a");
  assert.equal(nextSermonQueueItem(queue, "a")?.id, "b");
  assert.equal(nextSermonQueueItem(queue, "c"), null);
  assert.equal(nextSermonQueueItem(queue, "missing"), null);
});

test("当前队列和显示设置与最近保存方案一致时识别为已保存", () => {
  const queue = [item("a")];
  const plans: SermonPlanDTO[] = [
    { id: "old", title: "旧方案", queue, display, updatedAt: "2026-08-28T00:00:00.000Z" },
    { id: "new", title: "新方案", queue: structuredClone(queue), display: { ...display }, updatedAt: "2026-08-29T00:00:00.000Z" }
  ];
  assert.equal(matchingSermonPlan(plans, queue, display)?.id, "new");
  assert.equal(matchingSermonPlan(plans, [...queue, item("b")], display), null);
  assert.equal(matchingSermonPlan([{ ...plans[0], queue: [] }], [], display)?.id, "old", "空队列方案也能显示为已保存");
});
