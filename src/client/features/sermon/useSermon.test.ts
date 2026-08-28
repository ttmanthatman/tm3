import assert from "node:assert/strict";
import test from "node:test";
import type { SermonPresenterStatusDTO, SermonStateDTO } from "../../../shared/types.js";
import {
  applySermonRequestDecision,
  applySermonState,
  createSermonState,
  resetSermonState,
  useSermon,
  type SermonAck,
  type SermonSocket
} from "./useSermon.js";

function activeState(currentItemId: string | null = "item-1"): SermonStateDTO {
  return {
    active: true,
    queue: [
      {
        id: "item-1",
        reference: "约3:16",
        normalizedReference: "约翰福音 3:16",
        verses: [{ book: "约翰福音", chapter: 3, verse: 16, endVerse: 16, reference: "约翰福音 3:16", text: "神爱世人" }],
        annotations: []
      }
    ],
    currentItemId,
    presenterId: "7",
    presenterName: "张三",
    fontScale: 1,
    updatedAt: "2026-08-27T00:00:00.000Z"
  };
}

type FakeSocketOptions = {
  connected?: boolean;
  ack?: SermonAck | null;
  ackError?: Error | null;
};

function createHarness(options: FakeSocketOptions = {}) {
  const shared = createSermonState();
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
    state: shared,
    request: async <T>(path: string) => {
      requests.push(path);
      return { canPresent: true, until: "2026-09-01T00:00:00.000Z" } as T;
    }
  });
  return { sermon, shared, socket, emissions, requests };
}

test("applySermonState：全量保留服务端状态，激活与否由 active 字段表达", () => {
  applySermonState(activeState());
  const view = useSermon({ getSocket: () => null });
  assert.equal(view.sermonState.value?.currentItemId, "item-1");
  applySermonState({ ...activeState(null), active: false });
  assert.equal(view.sermonState.value?.active, false, "未激活时仍保留队列，否则讲道台看不到待展示条目");
  assert.equal(view.sermonState.value?.queue.length, 1);
  resetSermonState();
});

test("applySermonRequestDecision 记录最近一次审批结果", () => {
  const view = useSermon({ getSocket: () => null });
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
    ack: { ok: true, added: 2, errors: [{ reference: "无效", message: "无法识别该经文出处" }] }
  });
  const result = await sermon.add(["约3:16", "诗篇23"]);
  assert.deepEqual(emissions, [{ event: "sermon:add", payload: { references: ["约3:16", "诗篇23"] } }]);
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

test("setFontScale 发送 sermon:font-scale 事件", async () => {
  const { sermon, emissions } = createHarness();
  const result = await sermon.setFontScale(1.2);
  assert.equal(result.ok, true);
  assert.deepEqual(emissions, [{ event: "sermon:font-scale", payload: { scale: 1.2 } }]);
});

test("refreshPresenterStatus 拉取并缓存权限状态", async () => {
  const { sermon, requests } = createHarness();
  const status = await sermon.refreshPresenterStatus();
  assert.deepEqual(requests, ["/api/sermon/presenter-status"]);
  assert.equal((status as SermonPresenterStatusDTO).canPresent, true);
  assert.equal(sermon.presenterStatus.value?.until, "2026-09-01T00:00:00.000Z");
});
