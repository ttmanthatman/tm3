import assert from "node:assert/strict";
import test from "node:test";
import type { BibleVerseLineDTO, SermonSlideInput, SermonStateDTO } from "../../shared/types.js";
import {
  DEFAULT_SERMON_DISPLAY,
  SERMON_FONT_SCALE_MAX,
  SERMON_FONT_SCALE_MIN,
  SERMON_MARGIN_PCT_MAX,
  SERMON_MARGIN_PCT_MIN,
  SERMON_QUEUE_LIMIT,
  applyAdd,
  applyAddTexts,
  applyAnnotate,
  applyAnnotateClear,
  applyClear,
  applyDisplay,
  applyPresent,
  applyRemove,
  applyReorder,
  applyScroll,
  applySetScope,
  applyUpdate,
  createSermonStateStore,
  deserializeSermonState,
  emptySermonState,
  resolveSermonSlide,
  serializeSermonState,
  type SermonMutationContext,
  type SermonResolvedSlide
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

/** 构造一屏解析结果：单段经文（可指定节数）或纯文字。 */
function slide(reference: string, verseCount = 2): SermonResolvedSlide {
  return {
    blocks: [{ type: "passage", reference, normalizedReference: reference, verseStart: 0, verseCount }],
    verses: Array.from({ length: verseCount }, (_, i) => verse(i + 1)),
    source: reference
  };
}

function textSlide(content: string): SermonResolvedSlide {
  return { blocks: [{ type: "text", content }], verses: [], source: content };
}

/** 测试用经文查询：含「不存在」的出处抛错，其余返回固定两节。 */
function fakeResolve(reference: string) {
  if (reference.includes("不存在")) throw new Error("unrecognized reference");
  return { reference, normalizedReference: reference, translation: "译本", sourceId: "test", verses: [verse(1), verse(2)] };
}

test("applyAdd 追加条目并生成 id，更新 presenter 信息", () => {
  const state = applyAdd(emptySermonState(), [slide("约3:16"), slide("诗篇23")], ctx());
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
  state = applyAdd(state, Array.from({ length: SERMON_QUEUE_LIMIT }, (_, i) => slide(`条目${i}`)), context);
  assert.equal(state.queue.length, SERMON_QUEUE_LIMIT);
  const full = applyAdd(state, [slide("溢出")], context);
  assert.equal(full.queue.length, SERMON_QUEUE_LIMIT);
  assert.equal(full, state);
});

test("applyAddTexts 添加文字条目：不解析经文、标题可选、空正文忽略", () => {
  const state = applyAddTexts(
    emptySermonState(),
    [
      { title: "大纲", content: "一、引言\n\n二、正文" },
      { content: "无标题引文" },
      { title: "空", content: "  " }
    ],
    ctx()
  );
  assert.equal(state.queue.length, 2, "空正文条目被忽略");
  assert.equal(state.queue[0].kind, "text");
  assert.equal(state.queue[0].title, "大纲");
  assert.equal(state.queue[0].content, "一、引言\n\n二、正文");
  assert.equal(state.queue[0].normalizedReference, "大纲");
  assert.deepEqual(state.queue[0].verses, []);
  assert.deepEqual(state.queue[0].annotations, []);
  assert.equal(state.queue[1].title, undefined);
  assert.equal(state.queue[1].normalizedReference, "文字分享");
  assert.equal(state.presenterId, "7");
  assert.equal(applyAddTexts(state, [], ctx()), state, "空列表无操作");
});

test("文字条目的 present/remove 与经文一致，标注因无经节而无操作", () => {
  let counter = 0;
  const context = ctx({ createId: () => `id-${++counter}` });
  const state = applyAddTexts(emptySermonState(), [{ content: "引言" }], context);
  const presented = applyPresent(state, "id-1", ctx());
  assert.equal(presented.active, true);
  assert.equal(presented.currentItemId, "id-1");
  assert.equal(applyAnnotate(presented, "id-1", { verseIndex: 0, kind: "highlight" }, ctx()), presented, "文字条目没有经节，标注无操作");
  const removed = applyRemove(presented, "id-1", ctx());
  assert.equal(removed.active, false);
  assert.equal(removed.queue.length, 0);
});

test("文字条目序列化往返；缺正文的持久化文字条目整体回退为空状态", () => {
  const state = applyAddTexts(emptySermonState(), [{ title: "大纲", content: "一、引言" }], ctx());
  const restored = deserializeSermonState(serializeSermonState(state));
  assert.deepEqual(restored.queue[0], state.queue[0]);

  const corrupt = JSON.parse(serializeSermonState(state)) as { queue: Array<Record<string, unknown>> };
  delete corrupt.queue[0].content;
  assert.equal(deserializeSermonState(JSON.stringify(corrupt)).queue.length, 0);
});

test("applyReorder 按给定顺序重排，未知 id 忽略，缺失 id 保持相对顺序排尾", () => {
  let counter = 0;
  const context = ctx({ createId: () => `id-${++counter}` });
  const state = applyAdd(emptySermonState(), [slide("A"), slide("B"), slide("C")], context);
  const reordered = applyReorder(state, ["id-3", "missing", "id-1"], ctx());
  assert.deepEqual(reordered.queue.map((item) => item.id), ["id-3", "id-1", "id-2"]);
});

test("applyRemove 删除条目；删除当前展示条目时结束展示", () => {
  let counter = 0;
  const context = ctx({ createId: () => `id-${++counter}` });
  let state = applyAdd(emptySermonState(), [slide("A"), slide("B")], context);
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
  const state = applyAdd(emptySermonState(), [slide("A")], context);
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
  const state = applyAdd(emptySermonState(), [slide("A")], context);
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
  const state = applyAdd(emptySermonState(), [slide("A")], context);
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
  let state = applyAdd(emptySermonState(), [slide("A")], context);
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
  let state = applyAdd(emptySermonState(), [slide("A")], context);
  state = applyPresent(state, "id-1", ctx());
  const cleared = applyClear(state, ctx());
  assert.deepEqual(cleared.queue, []);
  assert.equal(cleared.active, false);
  assert.equal(cleared.currentItemId, null);
  assert.equal(cleared.presenterId, "7");
  assert.equal(applyClear(emptySermonState(), ctx()).queue.length, 0);
});

test("applyDisplay 更新倍率并夹取/取整；非法与相同值视为无操作", () => {
  const state = emptySermonState();
  assert.deepEqual(state.display, DEFAULT_SERMON_DISPLAY, "默认显示设置");

  const enlarged = applyDisplay(state, { fontScale: 1.2 }, ctx());
  assert.equal(enlarged.display.fontScale, 1.2);
  assert.equal(enlarged.presenterId, "7");
  assert.equal(enlarged.updatedAt, NOW);

  assert.equal(applyDisplay(state, { fontScale: 0.65 }, ctx()).display.fontScale, SERMON_FONT_SCALE_MIN, "低于下限夹到 0.7");
  assert.equal(applyDisplay(state, { fontScale: 1.75 }, ctx()).display.fontScale, SERMON_FONT_SCALE_MAX, "高于上限夹到 1.6");
  assert.equal(applyDisplay(state, { fontScale: 1.24 }, ctx()).display.fontScale, 1.2, "按 0.1 步进取整");
  assert.equal(applyDisplay(state, { fontScale: 1 }, ctx()), state, "与当前值相同不变更");
  assert.equal(applyDisplay(state, { fontScale: Number.NaN }, ctx()), state, "非有限数值不变更");
});

test("applyDisplay 按字段合并：字体族、边距、背景与文字颜色", () => {
  const state = emptySermonState();
  const patched = applyDisplay(state, { fontFamily: "songti", marginPct: 12, background: "sepia", textColor: "#3f3222" }, ctx());
  assert.deepEqual(patched.display, { fontFamily: "songti", fontScale: 1, marginPct: 12, background: "sepia", textColor: "#3f3222" });

  const merged = applyDisplay(patched, { fontScale: 1.3 }, ctx());
  assert.deepEqual(merged.display, { fontFamily: "songti", fontScale: 1.3, marginPct: 12, background: "sepia", textColor: "#3f3222" }, "未提供的字段保持不变");

  assert.equal(applyDisplay(state, { marginPct: 1 }, ctx()).display.marginPct, SERMON_MARGIN_PCT_MIN, "边距低于下限夹到 2");
  assert.equal(applyDisplay(state, { marginPct: 99 }, ctx()).display.marginPct, SERMON_MARGIN_PCT_MAX, "边距高于上限夹到 20");
  assert.equal(applyDisplay(state, { marginPct: 8.6 }, ctx()).display.marginPct, 9, "边距取整");
  assert.equal(applyDisplay(state, { marginPct: Number.NaN }, ctx()), state, "非有限边距不变更");
});

test("applyDisplay 非法字体族/背景被忽略，其余字段照常合并", () => {
  const state = emptySermonState();
  assert.equal(applyDisplay(state, { fontFamily: "serif" as never }, ctx()), state, "非法字体族不变更");
  assert.equal(applyDisplay(state, { background: "red" }, ctx()), state, "非法背景不变更");
  assert.equal(applyDisplay(state, { background: "#fff" }, ctx()), state, "非 6 位 hex 不变更");
  assert.equal(applyDisplay(state, { textColor: "white" }, ctx()), state, "非法文字颜色不变更");

  const partial = applyDisplay(state, { fontFamily: "serif" as never, background: "#123456" }, ctx());
  assert.equal(partial.display.background, "#123456", "同批合法字段仍生效");
  assert.equal(partial.display.fontFamily, "songti");

  const upperHex = applyDisplay(state, { background: "#A1B2C3" }, ctx());
  assert.equal(upperHex.display.background, "#A1B2C3", "大写 hex 合法");
});

test("deserialize 旧持久化数据迁移：扁平 fontScale 进入 display，其余字段按默认", () => {
  let counter = 0;
  const context = ctx({ createId: () => `id-${++counter}` });
  const state = applyAdd(emptySermonState(), [slide("约3:16")], context);
  const legacy = { ...state, updatedAt: NOW } as Record<string, unknown>;
  delete legacy.display;
  // 旧持久化队列条目也没有 kind 字段，反序列化按 bible 兼容
  legacy.queue = (legacy.queue as Array<Record<string, unknown>>).map((item) => {
    const copy = { ...item };
    delete copy.kind;
    return copy;
  });
  const restored = deserializeSermonState(JSON.stringify({ ...legacy, fontScale: 1.4 }));
  assert.equal(restored.display.fontScale, 1.4);
  assert.equal(restored.display.fontFamily, DEFAULT_SERMON_DISPLAY.fontFamily);
  assert.equal(restored.display.marginPct, DEFAULT_SERMON_DISPLAY.marginPct);
  assert.equal(restored.display.background, DEFAULT_SERMON_DISPLAY.background);
  assert.equal(restored.queue.length, 1);
  assert.equal(restored.queue[0].kind, "bible", "缺 kind 的旧条目迁移为 bible");

  // 更旧的数据连 fontScale 也没有：display 全部按默认
  const oldest = deserializeSermonState(JSON.stringify(legacy));
  assert.deepEqual(oldest.display, DEFAULT_SERMON_DISPLAY);

  const scaled = applyDisplay(state, { fontScale: 1.4 }, ctx());
  assert.equal(deserializeSermonState(serializeSermonState(scaled)).display.fontScale, 1.4);
  // 越界的持久化倍率整体回退为空状态（schema 校验失败）
  assert.equal(deserializeSermonState(JSON.stringify({ ...legacy, fontScale: 3 })).queue.length, 0);
  // 非法持久化背景同样整体回退
  assert.equal(
    deserializeSermonState(JSON.stringify({ ...state, display: { ...state.display, background: "red" } })).queue.length,
    0
  );
});

test("deserialize 已下架字体族（puhuiti/system）回退为默认字体，队列其余状态保留", () => {
  let counter = 0;
  const context = ctx({ createId: () => `id-${++counter}` });
  const state = applyAdd(emptySermonState(), [slide("约3:16")], context);
  for (const legacyFont of ["puhuiti", "system"]) {
    const restored = deserializeSermonState(
      JSON.stringify({ ...state, display: { ...state.display, fontFamily: legacyFont as never } })
    );
    assert.equal(restored.display.fontFamily, DEFAULT_SERMON_DISPLAY.fontFamily, `${legacyFont} 回退为默认字体`);
    assert.equal(restored.queue.length, 1, "队列保留");
  }
});

test("serialize/deserialize JSON 往返，损坏数据回退为空状态", () => {
  let counter = 0;
  const context = ctx({ createId: () => `id-${++counter}` });
  let state = applyAdd(emptySermonState(), [slide("约3:16")], context);
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

  await store.add({ id: "7", name: "讲道者" }, [slide("约3:16")]);
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

test("resolveSermonSlide：多处经文与文字混排，扁平经文与块切片对齐", () => {
  const input: SermonSlideInput = {
    blocks: [
      { type: "text", content: "引言" },
      { type: "reference", reference: "约3:16" },
      { type: "reference", reference: "诗篇23:1" }
    ]
  };
  const outcome = resolveSermonSlide(input, fakeResolve);
  assert.ok(outcome);
  const { blocks, verses, source } = outcome.resolved;
  assert.equal(verses.length, 4, "两段经文各两节，扁平拼接");
  assert.deepEqual(
    blocks.map((block) => (block.type === "passage" ? [block.type, block.verseStart, block.verseCount] : [block.type, block.content])),
    [["text", "引言"], ["passage", 0, 2], ["passage", 2, 2]]
  );
  assert.deepEqual(outcome.fallbacks, []);
  assert.equal(source, "引言\n约3:16\n诗篇23:1", "source 重建供热编辑预填");

  const state = applyAdd(emptySermonState(), [outcome.resolved], ctx());
  const item = state.queue[0];
  assert.equal(item.kind, "bible");
  assert.equal(item.normalizedReference, "约3:16；诗篇23:1");
  assert.equal(item.scrollLines, 0);
});

test("resolveSermonSlide：查不到的出处降级为文字块并记录提示", () => {
  const outcome = resolveSermonSlide(
    { blocks: [{ type: "reference", reference: "不存在的书 1:1" }] },
    fakeResolve
  );
  assert.ok(outcome, "降级后仍有内容，整屏不丢弃");
  assert.deepEqual(outcome.resolved.blocks, [{ type: "text", content: "不存在的书 1:1" }]);
  assert.deepEqual(outcome.fallbacks, ["不存在的书 1:1"]);
  assert.equal(outcome.resolved.verses.length, 0);

  const empty = resolveSermonSlide({ blocks: [{ type: "text", content: "   " }] }, fakeResolve);
  assert.equal(empty, null, "整屏无内容返回 null");
});

test("applyUpdate 热编辑：保留 id、重算内容、标注与滚动清零", () => {
  let counter = 0;
  const context = ctx({ createId: () => `id-${++counter}` });
  let state = applyAdd(
    emptySermonState(),
    [
      {
        blocks: [{ type: "passage", reference: "约3:16", normalizedReference: "约翰福音 3:16", verseStart: 0, verseCount: 2 }],
        verses: [verse(1), verse(2)],
        source: "约3:16"
      }
    ],
    context
  );
  state = applyPresent(state, "id-1", ctx());
  state = applyAnnotate(state, "id-1", { verseIndex: 0, kind: "highlight" }, ctx());
  state = applyScroll(state, "id-1", 3, ctx());
  assert.equal(state.queue[0].scrollLines, 3);

  const updated = applyUpdate(state, "id-1", textSlide("改后的文字"), ctx());
  assert.equal(updated.queue[0].id, "id-1", "id 不变，观众停留在同一屏");
  assert.equal(updated.queue[0].kind, "text");
  assert.equal(updated.queue[0].content, undefined, "屏内容由 blocks 承载");
  assert.deepEqual(updated.queue[0].blocks, [{ type: "text", content: "改后的文字" }]);
  assert.deepEqual(updated.queue[0].annotations, [], "经节可能变化，标注重置");
  assert.equal(updated.queue[0].scrollLines, 0, "滚动位置重置");
  assert.equal(applyUpdate(state, "missing", textSlide("x"), ctx()), state);
});

test("applyScroll 夹取非负整数，无变化视为无操作", () => {
  let counter = 0;
  const context = ctx({ createId: () => `id-${++counter}` });
  const state = applyAdd(emptySermonState(), [slide("A")], context);
  assert.equal(applyScroll(state, "id-1", 2.9, ctx()).queue[0].scrollLines, 2, "向下取整");
  assert.equal(applyScroll(state, "id-1", -1, ctx()).queue[0].scrollLines, 0, "负值夹到 0");
  assert.equal(applyScroll(state, "id-1", 0, ctx()), state, "缺省 0 视为无操作");
  assert.equal(applyScroll(state, "missing", 1, ctx()), state);
});

test("applyPresent 切换到带滚动遗留的条目时滚动归零", () => {
  let counter = 0;
  const context = ctx({ createId: () => `id-${++counter}` });
  let state = applyAdd(emptySermonState(), [slide("A"), slide("B")], context);
  state = applyPresent(state, "id-1", ctx());
  state = applyScroll(state, "id-1", 4, ctx());
  state = applyPresent(state, "id-2", ctx());
  assert.equal(state.queue[0].scrollLines, 4, "切走后保留原值，切回时由 present 归零");
  assert.equal(state.queue[1].scrollLines, 0);
  const backToFirst = applyPresent(state, "id-1", ctx());
  assert.equal(backToFirst.queue[0].scrollLines, 0);
});

test("blocks/source/scrollLines 序列化往返；旧数据无这些字段照常解析", () => {
  let counter = 0;
  const context = ctx({ createId: () => `id-${++counter}` });
  const mixed: SermonResolvedSlide = {
    blocks: [
      { type: "text", content: "引言" },
      { type: "passage", reference: "约3:16", normalizedReference: "约翰福音 3:16", verseStart: 0, verseCount: 2 }
    ],
    verses: [verse(1), verse(2)],
    source: "引言\n约3:16"
  };
  let state = applyAdd(emptySermonState(), [mixed], context);
  state = applyPresent(state, "id-1", context);
  state = applyScroll(state, "id-1", 2, context);
  const restored = deserializeSermonState(serializeSermonState(state));
  assert.deepEqual(restored.queue[0], state.queue[0]);

  // 旧持久化条目没有 blocks/source/scrollLines：正常解析且渲染回退路径不受影响
  const legacy = JSON.parse(serializeSermonState(state)) as { queue: Array<Record<string, unknown>> };
  for (const key of ["blocks", "source", "scrollLines"]) delete legacy.queue[0][key];
  const restoredLegacy = deserializeSermonState(JSON.stringify(legacy));
  assert.equal(restoredLegacy.queue.length, 1);
  assert.equal(restoredLegacy.queue[0].blocks, undefined);

  // passage 块切片越界的持久化数据整体回退为空状态
  const corrupt = JSON.parse(serializeSermonState(state)) as {
    queue: Array<{ blocks: Array<{ verseStart: number; verseCount: number }> }>;
  };
  corrupt.queue[0].blocks[1].verseCount = 99;
  assert.equal(deserializeSermonState(JSON.stringify(corrupt)).queue.length, 0);
});

test("scope：新状态默认小组，缺 scope 的旧持久化数据按集会迁移，往返保留", () => {
  assert.equal(emptySermonState().scope, "group", "新演示默认小组范围");

  let counter = 0;
  const context = ctx({ createId: () => `id-${++counter}` });
  const state = applyAdd(emptySermonState(), [slide("约3:16")], context);
  assert.equal(deserializeSermonState(serializeSermonState(state)).scope, "group", "序列化往返保留 scope");

  // 一期持久化数据没有 scope 字段：按集会处理（旧全局演示全员可观看）
  const legacy = JSON.parse(serializeSermonState(state)) as Record<string, unknown>;
  delete legacy.scope;
  const restored = deserializeSermonState(JSON.stringify(legacy));
  assert.equal(restored.scope, "assembly", "旧数据迁移为集会");
  assert.equal(restored.queue.length, 1, "迁移不丢队列");

  // 损坏的 scope 值同样回退为集会而不是整体清空
  const badScope = deserializeSermonState(JSON.stringify({ ...state, scope: "public" }));
  assert.equal(badScope.scope, "assembly");
  assert.equal(badScope.queue.length, 1);
});

test("applySetScope 与 store.setScope：设置范围、写入讲道者信息并持久化", async () => {
  const scoped = applySetScope(emptySermonState(), "assembly", ctx());
  assert.equal(scoped.scope, "assembly");
  assert.equal(scoped.presenterId, "7");
  assert.equal(scoped.updatedAt, NOW);
  assert.equal(applySetScope(scoped, "assembly", ctx()).scope, "assembly", "重复设置同一范围保持有效");

  let saved: string | null = null;
  const store = createSermonStateStore({
    persistence: {
      load: async () => saved,
      save: async (value: string) => {
        saved = value;
      }
    },
    createId: () => "id-1",
    now: () => new Date(NOW)
  });
  await store.load();
  await store.setScope({ id: "7", name: "讲道者" }, "group");
  assert.ok(saved, "setScope 持久化");
  assert.equal(deserializeSermonState(saved).scope, "group");
  assert.equal(deserializeSermonState(saved).presenterId, "7");
});
