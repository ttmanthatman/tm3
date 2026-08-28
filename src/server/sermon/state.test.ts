import assert from "node:assert/strict";
import test from "node:test";
import type { BibleVerseLineDTO, SermonStateDTO } from "../../shared/types.js";
import {
  SERMON_FONT_SCALE_MAX,
  SERMON_FONT_SCALE_MIN,
  SERMON_QUEUE_LIMIT,
  applyAdd,
  applyAnnotate,
  applyAnnotateClear,
  applyClear,
  applyFontScale,
  applyPresent,
  applyRemove,
  applyReorder,
  createSermonStateStore,
  deserializeSermonState,
  emptySermonState,
  serializeSermonState,
  type SermonMutationContext
} from "./state.js";

const NOW = "2026-08-27T12:00:00.000Z";

function verse(index: number): BibleVerseLineDTO {
  return {
    book: "约翰福音",
    chapter: 3,
    verse: index,
    endVerse: index,
    reference: `约翰福音 3:${index}`,
    text: `第${index}节经文`
  };
}

function ctx(overrides: Partial<SermonMutationContext> = {}): SermonMutationContext {
  let counter = 0;
  return {
    actor: { id: "7", name: "讲道者" },
    createId: () => `id-${++counter}`,
    now: NOW,
    ...overrides
  };
}

function entry(reference: string, verseCount = 2) {
  return {
    reference,
    normalizedReference: reference,
    verses: Array.from({ length: verseCount }, (_, i) => verse(i + 1))
  };
}

test("applyAdd 追加条目并生成 id，更新 presenter 信息", () => {
  const state = applyAdd(emptySermonState(), [entry("约3:16"), entry("诗篇23")], ctx());
  assert.equal(state.queue.length, 2);
  assert.deepEqual(state.queue.map((item) => item.id), ["id-1", "id-2"]);
  assert.equal(state.queue[0].normalizedReference, "约3:16");
  assert.deepEqual(state.queue[0].annotations, []);
  assert.equal(state.presenterId, "7");
  assert.equal(state.presenterName, "讲道者");
  assert.equal(state.updatedAt, NOW);
  assert.equal(state.active, false);
  assert.equal(state.currentItemId, null);
});

test("applyAdd 受队列上限约束", () => {
  let state = emptySermonState();
  let counter = 0;
  const context = ctx({ createId: () => `id-${++counter}` });
  state = applyAdd(state, Array.from({ length: SERMON_QUEUE_LIMIT }, (_, i) => entry(`条目${i}`)), context);
  assert.equal(state.queue.length, SERMON_QUEUE_LIMIT);
  const full = applyAdd(state, [entry("溢出")], context);
  assert.equal(full.queue.length, SERMON_QUEUE_LIMIT);
  assert.equal(full, state);
});

test("applyReorder 按给定顺序重排，未知 id 忽略，缺失 id 保持相对顺序排尾", () => {
  let counter = 0;
  const context = ctx({ createId: () => `id-${++counter}` });
  const state = applyAdd(emptySermonState(), [entry("A"), entry("B"), entry("C")], context);
  const reordered = applyReorder(state, ["id-3", "missing", "id-1"], ctx());
  assert.deepEqual(reordered.queue.map((item) => item.id), ["id-3", "id-1", "id-2"]);
});

test("applyRemove 删除条目；删除当前展示条目时结束展示", () => {
  let counter = 0;
  const context = ctx({ createId: () => `id-${++counter}` });
  let state = applyAdd(emptySermonState(), [entry("A"), entry("B")], context);
  state = applyPresent(state, "id-1", ctx());
  assert.equal(state.active, true);

  const removedOther = applyRemove(state, "id-2", ctx());
  assert.deepEqual(removedOther.queue.map((item) => item.id), ["id-1"]);
  assert.equal(removedOther.active, true);
  assert.equal(removedOther.currentItemId, "id-1");

  const removedCurrent = applyRemove(state, "id-1", ctx());
  assert.equal(removedCurrent.active, false);
  assert.equal(removedCurrent.currentItemId, null);

  assert.equal(applyRemove(state, "nope", ctx()), state);
});

test("applyPresent 切换与结束展示；未知 id 不变更", () => {
  let counter = 0;
  const context = ctx({ createId: () => `id-${++counter}` });
  const state = applyAdd(emptySermonState(), [entry("A")], context);
  const presented = applyPresent(state, "id-1", ctx());
  assert.equal(presented.active, true);
  assert.equal(presented.currentItemId, "id-1");
  const ended = applyPresent(presented, null, ctx());
  assert.equal(ended.active, false);
  assert.equal(ended.currentItemId, null);
  assert.equal(applyPresent(state, "missing", ctx()), state);
  // 空状态重复结束展示视为无操作
  assert.equal(applyPresent(emptySermonState(), null, ctx()).active, false);
});

test("applyAnnotate 追加标注，重复提交相同标注时取消", () => {
  let counter = 0;
  const context = ctx({ createId: () => `id-${++counter}` });
  const state = applyAdd(emptySermonState(), [entry("A")], context);
  const annotated = applyAnnotate(state, "id-1", { verseIndex: 0, kind: "highlight" }, ctx());
  assert.deepEqual(annotated.queue[0].annotations, [{ verseIndex: 0, kind: "highlight" }]);
  const toggledOff = applyAnnotate(annotated, "id-1", { verseIndex: 0, kind: "highlight" }, ctx());
  assert.deepEqual(toggledOff.queue[0].annotations, []);
  const ranged = applyAnnotate(state, "id-1", { verseIndex: 1, kind: "underline", start: 1, end: 3 }, ctx());
  assert.deepEqual(ranged.queue[0].annotations, [{ verseIndex: 1, kind: "underline", start: 1, end: 3 }]);
});

test("applyAnnotate 拒绝越界 verseIndex 与非法偏移", () => {
  let counter = 0;
  const context = ctx({ createId: () => `id-${++counter}` });
  const state = applyAdd(emptySermonState(), [entry("A")], context);
  assert.equal(applyAnnotate(state, "id-1", { verseIndex: 5, kind: "highlight" }, ctx()), state);
  assert.equal(applyAnnotate(state, "missing", { verseIndex: 0, kind: "highlight" }, ctx()), state);
  assert.equal(applyAnnotate(state, "id-1", { verseIndex: 0, kind: "underline", start: 3, end: 3 }, ctx()), state);
  assert.equal(applyAnnotate(state, "id-1", { verseIndex: 0, kind: "underline", start: 0, end: 99 }, ctx()), state);
  // 只给 start 不给 end 同样非法
  assert.equal(applyAnnotate(state, "id-1", { verseIndex: 0, kind: "underline", start: 0 }, ctx()), state);
});

test("applyAnnotateClear 按节、按类型或全部清除", () => {
  let counter = 0;
  const context = ctx({ createId: () => `id-${++counter}` });
  let state = applyAdd(emptySermonState(), [entry("A")], context);
  state = applyAnnotate(state, "id-1", { verseIndex: 0, kind: "highlight" }, ctx());
  state = applyAnnotate(state, "id-1", { verseIndex: 0, kind: "underline" }, ctx());
  state = applyAnnotate(state, "id-1", { verseIndex: 1, kind: "highlight" }, ctx());
  assert.equal(state.queue[0].annotations.length, 3);

  const byKind = applyAnnotateClear(state, "id-1", { kind: "highlight" }, ctx());
  assert.deepEqual(byKind.queue[0].annotations, [{ verseIndex: 0, kind: "underline" }]);

  const byVerse = applyAnnotateClear(state, "id-1", { verseIndex: 0 }, ctx());
  assert.deepEqual(byVerse.queue[0].annotations, [{ verseIndex: 1, kind: "highlight" }]);

  const byBoth = applyAnnotateClear(state, "id-1", { verseIndex: 0, kind: "underline" }, ctx());
  assert.deepEqual(byBoth.queue[0].annotations, [
    { verseIndex: 0, kind: "highlight" },
    { verseIndex: 1, kind: "highlight" }
  ]);

  const all = applyAnnotateClear(state, "id-1", {}, ctx());
  assert.deepEqual(all.queue[0].annotations, []);

  assert.equal(applyAnnotateClear(state, "missing", {}, ctx()), state);
});

test("applyClear 清空队列并结束展示", () => {
  let counter = 0;
  const context = ctx({ createId: () => `id-${++counter}` });
  let state = applyAdd(emptySermonState(), [entry("A")], context);
  state = applyPresent(state, "id-1", ctx());
  const cleared = applyClear(state, ctx());
  assert.deepEqual(cleared.queue, []);
  assert.equal(cleared.active, false);
  assert.equal(cleared.currentItemId, null);
  assert.equal(cleared.presenterId, "7");
  assert.equal(applyClear(emptySermonState(), ctx()).queue.length, 0);
});

test("applyFontScale 更新倍率并夹取/取整；非法与相同值视为无操作", () => {
  const state = emptySermonState();
  assert.equal(state.fontScale, 1, "默认倍率为 1");

  const enlarged = applyFontScale(state, 1.2, ctx());
  assert.equal(enlarged.fontScale, 1.2);
  assert.equal(enlarged.presenterId, "7");
  assert.equal(enlarged.updatedAt, NOW);

  assert.equal(applyFontScale(state, 0.65, ctx()).fontScale, SERMON_FONT_SCALE_MIN, "低于下限夹到 0.7");
  assert.equal(applyFontScale(state, 1.75, ctx()).fontScale, SERMON_FONT_SCALE_MAX, "高于上限夹到 1.6");
  assert.equal(applyFontScale(state, 1.24, ctx()).fontScale, 1.2, "按 0.1 步进取整");
  assert.equal(applyFontScale(state, 1, ctx()), state, "与当前值相同不变更");
  assert.equal(applyFontScale(state, Number.NaN, ctx()), state, "非有限数值不变更");
});

test("deserialize 旧持久化数据缺 fontScale 时默认 1", () => {
  let counter = 0;
  const context = ctx({ createId: () => `id-${++counter}` });
  const state = applyAdd(emptySermonState(), [entry("约3:16")], context);
  const legacy = { ...state, updatedAt: NOW } as Record<string, unknown>;
  delete legacy.fontScale;
  const restored = deserializeSermonState(JSON.stringify(legacy));
  assert.equal(restored.fontScale, 1);
  assert.equal(restored.queue.length, 1);

  const scaled = applyFontScale(state, 1.4, ctx());
  assert.equal(deserializeSermonState(serializeSermonState(scaled)).fontScale, 1.4);
  // 越界的持久化倍率整体回退为空状态（schema 校验失败）
  assert.equal(deserializeSermonState(JSON.stringify({ ...state, fontScale: 3 })).queue.length, 0);
});

test("serialize/deserialize JSON 往返，损坏数据回退为空状态", () => {
  let counter = 0;
  const context = ctx({ createId: () => `id-${++counter}` });
  let state = applyAdd(emptySermonState(), [entry("约3:16")], context);
  state = applyAnnotate(state, "id-1", { verseIndex: 0, kind: "highlight" }, ctx());
  state = applyPresent(state, "id-1", ctx());

  const roundTripped = deserializeSermonState(serializeSermonState(state));
  assert.deepEqual(roundTripped, state);

  assert.deepEqual(deserializeSermonState(null).queue, []);
  assert.equal(deserializeSermonState("not json").active, false);
  assert.equal(deserializeSermonState(JSON.stringify({ active: "yes" })).queue.length, 0);
  // currentItemId 指向不存在条目时自动纠正
  const stale = deserializeSermonState(JSON.stringify({ ...state, currentItemId: "gone" }));
  assert.equal(stale.active, false);
  assert.equal(stale.currentItemId, null);
});

test("store 变更后持久化并可重新加载", async () => {
  let saved: string | null = null;
  const persistence = {
    load: async () => saved,
    save: async (value: string) => {
      saved = value;
    }
  };
  let counter = 0;
  const store = createSermonStateStore({ persistence, createId: () => `id-${++counter}`, now: () => new Date(NOW) });
  await store.load();
  assert.equal(store.getState().active, false);

  await store.add({ id: "7", name: "讲道者" }, [entry("约3:16")]);
  assert.ok(saved);
  await store.present({ id: "7", name: "讲道者" }, "id-1");
  assert.equal(store.getState().active, true);

  const restored = createSermonStateStore({ persistence });
  const loaded = await restored.load();
  assert.equal(loaded.active, true);
  assert.equal(loaded.currentItemId, "id-1");
  assert.equal(loaded.queue.length, 1);

  await restored.clear({ id: "7", name: "讲道者" });
  const cleared = deserializeSermonState(saved);
  assert.equal(cleared.queue.length, 0);
  assert.equal(cleared.active, false);
});
