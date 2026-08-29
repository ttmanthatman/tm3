import assert from "node:assert/strict";
import test from "node:test";
import type {
  SermonPresentationSummaryDTO,
  SermonPresenterStatusDTO,
  SermonStateDTO,
  SermonWatchAccountDTO
} from "../../../shared/types.js";
import {
  applySermonDirectory,
  applySermonEnded,
  applySermonInvited,
  applySermonPreview,
  applySermonRemoved,
  applySermonRequestDecision,
  applySermonState,
  createSermonState,
  isSermonPresenterMuted,
  loadSermonMutedIds,
  muteSermonPresenter,
  refreshSermonDirectory,
  releaseSermonAudienceSeat,
  resetSermonState,
  setSermonOwnAccountId,
  useSermon,
  type SermonAck,
  type SermonSharedState,
  type SermonSocket
} from "./useSermon.js";

// Node 测试环境没有 localStorage；静音持久化用最小内存桩验证。
const localStorageStore = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => (localStorageStore.has(key) ? localStorageStore.get(key)! : null),
    setItem: (key: string, value: string) => void localStorageStore.set(key, String(value)),
    removeItem: (key: string) => void localStorageStore.delete(key),
    clear: () => localStorageStore.clear()
  },
  configurable: true
});

function activeState(currentItemId: string | null = "item-1"): SermonStateDTO {
  return {
    active: true,
    queue: [
      {
        id: "item-1",
        kind: "bible" as const,
        reference: "约3:16",
        normalizedReference: "约翰福音 3:16",
        verses: [{ book: "约翰福音", chapter: 3, verse: 16, endVerse: 16, reference: "约翰福音 3:16", text: "神爱世人" }],
        annotations: []
      }
    ],
    currentItemId,
    presenterId: "7",
    presenterName: "张三",
    scope: "group" as const,
    display: { fontFamily: "songti", fontScale: 1, lineHeight: 1.6, marginPct: 4, background: "gradient" },
    updatedAt: "2026-08-27T00:00:00.000Z"
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

type FakeSocketOptions = {
  connected?: boolean;
  ack?: SermonAck | null;
  ackError?: Error | null;
};

function createHarness(options: FakeSocketOptions & { state?: SermonSharedState } = {}) {
  const emissions: Array<{ event: string; payload: unknown }> = [];
  const socket: SermonSocket = {
    connected: options.connected ?? true,
    timeout() {
      return this;
    },
    emit(event, payload, ack) {
      emissions.push({ event, payload });
      if (options.ackError) ack(options.ackError);
      else ack(null, options.ack === null ? undefined : (options.ack ?? { ok: true }));
    }
  };
  const requests: string[] = [];
  const sermon = useSermon({
    getSocket: () => socket,
    // 默认操作模块级单例，便于与 apply* 订阅入口互相验证；需要隔离时传 state。
    ...(options.state ? { state: options.state } : {}),
    request: async <T>(path: string) => {
      requests.push(path);
      if (path === "/api/sermon/accounts") {
        return [
          { id: 2, displayName: "李四", avatarPath: null, online: true, seatedPresentation: 7 }
        ] as T;
      }
      if (path === "/api/sermon/directory") {
        return [summary(9)] as T;
      }
      return { canPresent: true, until: "2026-09-01T00:00:00.000Z", isAdmin: true } as T;
    }
  });
  return { sermon, socket, emissions, requests };
}

/** 读取模块级共享状态的便捷视图（不传 state 时 useSermon 使用模块单例）。 */
function sharedView() {
  return useSermon({ getSocket: () => null });
}

test("applySermonState 仅应用本人主持或已入座的演示", () => {
  setSermonOwnAccountId(7);
  applySermonState(activeState());
  const view = sharedView();
  assert.equal(view.ownedState.value?.currentItemId, "item-1");
  // 他人演示的推送：未入座时忽略。
  applySermonState({ ...activeState(), presenterId: "9", presenterName: "李四" });
  assert.equal(view.ownedState.value?.presenterId, "7", "他人演示的推送不应覆盖本人讲道台状态");
  assert.equal(view.watchedState.value, null);
  // 激活状态由 active 字段表达，未激活仍保留队列。
  applySermonState({ ...activeState(null), active: false });
  assert.equal(view.ownedState.value?.active, false);
  assert.equal(view.ownedState.value?.queue.length, 1);
  resetSermonState();
  setSermonOwnAccountId(null);
});

/** 可控制 ack 的共享状态操作器（默认操作模块级单例）。 */
function createOperator(ack: SermonAck = { ok: true }) {
  return useSermon({
    getSocket: () => ({
      connected: true,
      timeout() {
        return this;
      },
      emit(_event: string, _payload: unknown, cb: (error: Error | null, response?: SermonAck) => void) {
        cb(null, ack);
      }
    })
  });
}

test("applySermonState 在入座后应用所坐演示的推送", async () => {
  setSermonOwnAccountId(7);
  const view = sharedView();
  const operator = createOperator();
  const result = await operator.join(9);
  assert.equal(result.ok, true);
  assert.equal(view.joinedPresentationId.value, 9);
  applySermonState({ ...activeState(), presenterId: "9", presenterName: "李四" });
  assert.equal(view.watchedState.value?.presenterId, "9", "入座后应应用所坐演示的推送");
  applySermonState({ ...activeState(), presenterId: "7", presenterName: "张三" });
  assert.equal(view.watchedState.value?.presenterId, "9", "本人讲道台推送不能覆盖正在观看的画面");
  assert.equal(view.ownedState.value?.presenterId, "7", "本人主持状态独立保存");
  await operator.leave();
  resetSermonState();
  setSermonOwnAccountId(null);
});

test("applySermonDirectory 全量替换目录并 prune 失效邀请", () => {
  applySermonInvited({ presenterId: 3, presenterName: "王五", scope: "group" });
  applySermonInvited({ presenterId: 4, presenterName: "赵六", scope: "assembly" });
  applySermonDirectory([summary(3)]);
  const view = sharedView();
  assert.deepEqual(view.directory.value.map((entry) => entry.presenterId), [3]);
  assert.deepEqual(view.invites.value.map((invite) => invite.presenterId), [3], "目录中不存在的演示其邀请应被 prune");
  applySermonDirectory(null);
  assert.deepEqual(view.directory.value, []);
  assert.deepEqual(view.invites.value, [], "目录清空时邀请全部失效");
  resetSermonState();
});

test("小组讲道预览由定向事件缓存，目录刷新时保留并在停播后清理", () => {
  applySermonDirectory([summary(3, { active: true })]);
  applySermonPreview({
    presenterId: 3,
    preview: { item: activeState().queue[0], display: activeState().display }
  });
  const view = sharedView();
  assert.equal(view.previews.value[3]?.item?.id, "item-1");
  applySermonDirectory([summary(3, { active: true, preview: null })]);
  assert.equal(view.previews.value[3]?.item?.id, "item-1", "全局目录不携带小组预览时保留定向快照");
  applySermonDirectory([summary(3, { active: false })]);
  assert.equal(view.previews.value[3], undefined, "演示停止后移除预览");
  resetSermonState();
});

test("applySermonInvited 按讲道者去重叠加", () => {
  applySermonInvited({ presenterId: 3, presenterName: "王五", scope: "group" });
  applySermonInvited({ presenterId: 4, presenterName: "赵六", scope: "assembly" });
  applySermonInvited({ presenterId: 3, presenterName: "王五", scope: "assembly" });
  const view = sharedView();
  assert.deepEqual(
    [...view.invites.value.map((invite) => `${invite.presenterId}:${invite.scope}`)].sort(),
    ["3:assembly", "4:assembly"],
    "同一讲道者的重复邀请应替换而非叠加"
  );
  resetSermonState();
});

test("applySermonRemoved 释放匹配席位、清除邀请并给出轻提示", async () => {
  const operator = createOperator();
  await operator.join(9);
  applySermonState({ ...activeState(), presenterId: "9", presenterName: "李四" });
  applySermonInvited({ presenterId: 9, presenterName: "李四", scope: "group" });
  applySermonRemoved({ presenterId: 9, presenterName: "李四" });
  const view = sharedView();
  assert.equal(view.joinedPresentationId.value, null, "被移出应释放入座");
  assert.equal(view.watchedState.value, null, "被移出应清空观看中的演示状态");
  assert.deepEqual(view.invites.value, []);
  assert.deepEqual(view.notice.value, { kind: "removed", presenterName: "李四" });
  // 不匹配当前入座的移除事件只影响提示与邀请。
  applySermonRemoved({ presenterId: 5, presenterName: "钱七" });
  assert.equal(view.notice.value?.presenterName, "钱七");
  resetSermonState();
});

test("applySermonEnded 释放席位并给出轻提示", async () => {
  const operator = createOperator();
  await operator.join(9);
  applySermonEnded({ presenterId: 9, presenterName: "李四" });
  const view = sharedView();
  assert.equal(view.joinedPresentationId.value, null);
  assert.deepEqual(view.notice.value, { kind: "ended", presenterName: "李四" });
  resetSermonState();
});

test("断线时 releaseSermonAudienceSeat 仅释放非本人主持的入座", async () => {
  setSermonOwnAccountId(7);
  const operator = createOperator();
  await operator.join(9);
  releaseSermonAudienceSeat();
  const view = sharedView();
  assert.equal(view.joinedPresentationId.value, null, "观众断线应释放入座");
  await operator.start("group");
  assert.equal(view.joinedPresentationId.value, null, "主持自己的讲道台不占用观众席");
  releaseSermonAudienceSeat();
  assert.equal(view.joinedPresentationId.value, null, "主持状态与观看席位保持分离");
  resetSermonState();
  setSermonOwnAccountId(null);
});

test("join 成功入座并移除对应邀请；seated-elsewhere 时回滚并透出 code", async () => {
  applySermonInvited({ presenterId: 9, presenterName: "李四", scope: "group" });
  const reject = createHarness({ ack: { ok: false, message: "你正在观看其他演示", code: "seated-elsewhere" } });
  const rejected = await reject.sermon.join(9);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) {
    assert.equal(rejected.reason, "rejected");
    assert.equal(rejected.code, "seated-elsewhere");
    assert.equal(rejected.message, "你正在观看其他演示");
  }
  assert.equal(sharedView().joinedPresentationId.value, null, "拒绝后应回滚乐观入座");
  const ok = createHarness();
  const joined = await ok.sermon.join(9);
  assert.equal(joined.ok, true);
  assert.equal(sharedView().joinedPresentationId.value, 9);
  assert.deepEqual(ok.emissions, [{ event: "sermon:join", payload: { presenterId: 9 } }]);
  assert.deepEqual(sharedView().invites.value, [], "加入后对应邀请应被清除");
  resetSermonState();
});

test("start/leave/invite/removeViewer/end 事件载荷符合契约", async () => {
  setSermonOwnAccountId(7);
  const { sermon, emissions } = createHarness();
  const started = await sermon.start("group", [2, 3]);
  assert.equal(started.ok, true);
  assert.equal(sharedView().joinedPresentationId.value, null, "start 不应把主持人标记为观众");
  await sermon.invite([4, 5]);
  await sermon.removeViewer(2);
  await sermon.end();
  assert.deepEqual(emissions, [
    { event: "sermon:start", payload: { scope: "group", invitedAccountIds: [2, 3] } },
    { event: "sermon:invite", payload: { accountIds: [4, 5] } },
    { event: "sermon:remove-viewer", payload: { accountId: 2 } },
    { event: "sermon:end", payload: {} }
  ]);
  const left = await sermon.leave();
  assert.equal(left.ok, true);
  assert.equal(sharedView().joinedPresentationId.value, null, "leave 成功后释放入座");
  assert.deepEqual(emissions[4], { event: "sermon:leave", payload: {} });
  // 管理员强制结束他人演示。
  await sermon.end(9);
  assert.deepEqual(emissions[5], { event: "sermon:end", payload: { presenterId: 9 } });
  resetSermonState();
  setSermonOwnAccountId(null);
});

test("命名方案操作发送正确事件并缓存服务端返回列表", async () => {
  const plan = {
    id: "plan-1",
    title: "8月30日分享",
    queue: activeState().queue,
    display: activeState().display,
    updatedAt: "2026-08-29T00:00:00.000Z"
  };
  const { sermon, emissions } = createHarness({ ack: { ok: true, plans: [plan] } });
  await sermon.refreshPlans();
  await sermon.savePlan("8月30日分享");
  await sermon.savePlan("8月30日分享", "plan-1");
  await sermon.loadPlan("plan-1");
  await sermon.deletePlan("plan-1");
  assert.deepEqual(emissions, [
    { event: "sermon:plans", payload: {} },
    { event: "sermon:plan-save", payload: { title: "8月30日分享" } },
    { event: "sermon:plan-save", payload: { title: "8月30日分享", id: "plan-1" } },
    { event: "sermon:plan-load", payload: { id: "plan-1" } },
    { event: "sermon:plan-delete", payload: { id: "plan-1" } }
  ]);
  assert.equal(sermon.plans.value[0].title, "8月30日分享");
  resetSermonState();
});

test("start 被拒绝时回滚乐观入座", async () => {
  setSermonOwnAccountId(7);
  const { sermon } = createHarness({ ack: { ok: false, message: "请先开始演示" } });
  const result = await sermon.start("assembly");
  assert.equal(result.ok, false);
  assert.equal(sharedView().joinedPresentationId.value, null);
  resetSermonState();
  setSermonOwnAccountId(null);
});

test("静音集合按账号持久化到 localStorage", () => {
  localStorageStore.clear();
  assert.equal(isSermonPresenterMuted(42, 3), false);
  muteSermonPresenter(42, 3);
  muteSermonPresenter(42, 3);
  assert.equal(isSermonPresenterMuted(42, 3), true);
  assert.deepEqual(loadSermonMutedIds(42), new Set([3]));
  assert.equal(localStorageStore.get("team-chat-sermon-muted:42"), "[3]", "静音集合应写入按账号命名空间的键");
  assert.equal(isSermonPresenterMuted(43, 3), false, "其他账号的静音集合互不影响");
  resetSermonState();
});

test("refreshSermonDirectory 走 HTTP 并应用目录", async () => {
  const requests: string[] = [];
  await refreshSermonDirectory(async <T>(path: string) => {
    requests.push(path);
    return [summary(9)] as T;
  });
  assert.deepEqual(requests, ["/api/sermon/directory"]);
  assert.deepEqual(sharedView().directory.value.map((entry) => entry.presenterId), [9]);
  resetSermonState();
});

test("refreshWatchAccounts 拉取观众选择器数据", async () => {
  const { sermon, requests } = createHarness();
  const accounts = await sermon.refreshWatchAccounts();
  assert.deepEqual(requests, ["/api/sermon/accounts"]);
  assert.equal((accounts as SermonWatchAccountDTO[])[0].seatedPresentation, 7);
  assert.equal(sharedView().watchAccounts.value.length, 1);
  resetSermonState();
});

test("applySermonRequestDecision 记录最近一次审批结果", () => {
  const view = sharedView();
  applySermonRequestDecision({ messageId: 12, approve: true, until: "2026-09-03T00:00:00.000Z" });
  assert.deepEqual(view.latestRequestDecision.value, { messageId: 12, approve: true, until: "2026-09-03T00:00:00.000Z" });
  applySermonRequestDecision({ messageId: Number.NaN, approve: false, until: null });
  assert.equal(view.latestRequestDecision.value?.messageId, 12, "非法 messageId 不应覆盖现有记录");
  resetSermonState();
});

test("断线时 emit 直接拒绝且不发包", async () => {
  const { sermon, emissions } = createHarness({ connected: false });
  const result = await sermon.present("item-1");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "disconnected");
  assert.equal(emissions.length, 0);
  assert.equal(sermon.statusMessage.value, "连接恢复后再操作");
});

test("ack ok 时透传 added/errors，事件与载荷正确", async () => {
  const { sermon, emissions } = createHarness({
    ack: { ok: true, added: 2, errors: [{ reference: "无效", message: "无法识别该经文出处，已作为文字加入" }] }
  });
  const slides = [
    { blocks: [{ type: "reference" as const, reference: "约3:16" }] },
    { blocks: [{ type: "reference" as const, reference: "诗篇23" }] }
  ];
  const result = await sermon.add(slides);
  assert.deepEqual(emissions, [{ event: "sermon:add", payload: { slides } }]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.added, 2);
    assert.equal(result.errors?.[0].reference, "无效");
  }
  assert.equal(sermon.pending.value, false);
  assert.equal(sermon.statusMessage.value, "");
});

test("ack ok:false 时以服务端 message 拒绝", async () => {
  const { sermon } = createHarness({ ack: { ok: false, message: "无讲道权限" } });
  const result = await sermon.clearPresentation();
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "rejected");
    assert.equal(result.message, "无讲道权限");
  }
  assert.equal(sermon.statusMessage.value, "无讲道权限");
});

test("ACK 超时映射为 timeout 原因", async () => {
  const { sermon } = createHarness({ ackError: new Error("timeout") });
  const result = await sermon.remove("item-1");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "timeout");
});

test("annotate/clearAnnotations 载荷形状符合契约", async () => {
  const { sermon, emissions } = createHarness();
  await sermon.annotate("item-1", { verseIndex: 0, kind: "underline", start: 2, end: 5 });
  await sermon.clearAnnotations("item-1", 0, "highlight");
  await sermon.clearAnnotations("item-1");
  assert.deepEqual(emissions[0], { event: "sermon:annotate", payload: { itemId: "item-1", annotation: { verseIndex: 0, kind: "underline", start: 2, end: 5 } } });
  assert.deepEqual(emissions[1], { event: "sermon:annotate:clear", payload: { itemId: "item-1", verseIndex: 0, kind: "highlight" } });
  assert.deepEqual(emissions[2], { event: "sermon:annotate:clear", payload: { itemId: "item-1" } });
});

test("setDisplay 发送 sermon:display 事件", async () => {
  const { sermon, emissions } = createHarness();
  const result = await sermon.setDisplay({ fontScale: 1.2, lineHeight: 1.4, background: "midnight" });
  assert.equal(result.ok, true);
  assert.deepEqual(emissions, [{ event: "sermon:display", payload: { fontScale: 1.2, lineHeight: 1.4, background: "midnight" } }]);
});

test("update/scroll/setLayout 发送热编辑、滚动与逐页排版事件", async () => {
  const { sermon, emissions } = createHarness();
  const slide = { blocks: [{ type: "text" as const, content: "改后的文字" }] };
  const updateResult = await sermon.update("item-1", slide);
  assert.equal(updateResult.ok, true);
  const scrollResult = await sermon.scroll("item-1", 3);
  assert.equal(scrollResult.ok, true);
  const layoutResult = await sermon.setLayout("item-1", { paragraph: false, centered: true });
  assert.equal(layoutResult.ok, true);
  assert.deepEqual(emissions, [
    { event: "sermon:update", payload: { id: "item-1", slide } },
    { event: "sermon:scroll", payload: { id: "item-1", lines: 3 } },
    { event: "sermon:layout", payload: { id: "item-1", paragraph: false, centered: true } }
  ]);
});

test("refreshPresenterStatus 拉取并缓存权限状态", async () => {
  const { sermon, requests } = createHarness();
  const status = await sermon.refreshPresenterStatus();
  assert.deepEqual(requests, ["/api/sermon/presenter-status"]);
  assert.equal((status as SermonPresenterStatusDTO).canPresent, true);
  assert.equal((status as SermonPresenterStatusDTO).isAdmin, true);
  assert.equal(sermon.presenterStatus.value?.until, "2026-09-01T00:00:00.000Z");
});
