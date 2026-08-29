import assert from "node:assert/strict";
import test from "node:test";
import type { SermonInvitedEvent, SermonPresentationSummaryDTO } from "../../../shared/types.js";
import { computeWatchablePresentations, visibleSermonInvites } from "./sermonHub.js";

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

function invite(presenterId: number, scope: "group" | "assembly" = "group"): SermonInvitedEvent {
  return { presenterId, presenterName: `讲道者${presenterId}`, scope };
}

const NO_SEAT = {
  directory: [] as SermonPresentationSummaryDTO[],
  invites: [] as SermonInvitedEvent[],
  mutedIds: new Set<number>(),
  joinedPresentationId: null,
  ownAccountId: null
};

test("集会演示仅进行中可观看；小组演示需持有邀请", () => {
  const result = computeWatchablePresentations({
    ...NO_SEAT,
    directory: [
      summary(1, { scope: "assembly", active: true }),
      summary(2, { scope: "assembly", active: false }),
      summary(3, { scope: "group", active: true }),
      summary(4, { scope: "group", active: true })
    ],
    invites: [invite(3), invite(4)]
  });
  assert.deepEqual(
    result.map((entry) => entry.summary.presenterId),
    [1, 3, 4],
    "未受邀的小组演示与未开始的集会演示不可观看"
  );
});

test("已静音的受邀小组演示不列入可观看列表", () => {
  const result = computeWatchablePresentations({
    ...NO_SEAT,
    directory: [summary(3), summary(4, { scope: "assembly" })],
    invites: [invite(3), invite(4)],
    mutedIds: new Set([3])
  });
  assert.deepEqual(
    result.map((entry) => entry.summary.presenterId),
    [4]
  );
});

test("刷新后可用目录中的服务端观看许可恢复小组通知", () => {
  const result = computeWatchablePresentations({
    ...NO_SEAT,
    directory: [summary(3, { invitedAccountIds: [7] })],
    ownAccountId: 7
  });
  assert.deepEqual(result.map((entry) => entry.summary.presenterId), [3]);
});

test("本人自己的演示不列入可观看列表", () => {
  const result = computeWatchablePresentations({
    ...NO_SEAT,
    directory: [summary(7, { scope: "assembly" }), summary(8, { scope: "assembly" })],
    ownAccountId: 7
  });
  assert.deepEqual(
    result.map((entry) => entry.summary.presenterId),
    [8]
  );
});

test("入座他席时其他演示标记 blocked，本人所坐标记 watching", () => {
  const result = computeWatchablePresentations({
    ...NO_SEAT,
    directory: [summary(3), summary(4, { scope: "assembly" })],
    invites: [invite(3)],
    joinedPresentationId: 3
  });
  const byId = new Map(result.map((entry) => [entry.summary.presenterId, entry]));
  assert.equal(byId.get(3)?.watching, true);
  assert.equal(byId.get(3)?.blocked, false);
  assert.equal(byId.get(4)?.watching, false);
  assert.equal(byId.get(4)?.blocked, true, "入座他席时不能直接加入其他演示");
});

test("visibleSermonInvites 过滤已静音的邀请", () => {
  const invites = [invite(1), invite(2), invite(3)];
  assert.deepEqual(
    visibleSermonInvites(invites, new Set([2])).map((entry) => entry.presenterId),
    [1, 3]
  );
});
