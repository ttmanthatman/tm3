import assert from "node:assert/strict";
import test from "node:test";
import type { Socket } from "socket.io";
import type { SermonStateDTO } from "../../shared/types.js";
import { createSermonStateStore, type SermonStateStore } from "./state.js";
import { registerSermonSocket, type SermonPresenterProfile } from "./socket.js";

type Ack = (payload: unknown) => void;
type Handler = (data: unknown, ack?: Ack) => Promise<void>;

function createHarness(options: {
  auth?: { accountId: number } | null;
  profile?: SermonPresenterProfile | null;
} = {}) {
  const auth = options.auth === undefined ? { accountId: 7 } : options.auth;
  const profile =
    options.profile === undefined
      ? { isAdmin: false, displayName: "讲道者", sermonPresenterUntil: new Date(Date.now() + 60_000) }
      : options.profile;
  let saved: string | null = null;
  let counter = 0;
  const store = createSermonStateStore({
    persistence: {
      load: async () => saved,
      save: async (value: string) => {
        saved = value;
      }
    },
    createId: () => `id-${++counter}`,
    now: () => new Date("2026-08-27T12:00:00.000Z")
  });

  const handlers = new Map<string, Handler>();
  const socketEmitted: Array<{ event: string; payload: unknown }> = [];
  const socket = {
    on: (event: string, handler: Handler) => {
      handlers.set(event, handler);
    },
    emit: (event: string, payload: unknown) => {
      socketEmitted.push({ event, payload });
    },
    data: {}
  } as unknown as Socket;

  const broadcasted: SermonStateDTO[] = [];
  const io = {
    emit: (_event: string, payload: unknown) => {
      broadcasted.push(payload as SermonStateDTO);
    }
  };

  registerSermonSocket(io, socket, {
    refreshAuth: async () => auth,
    presenterAccount: async () => profile,
    store
  });

  async function invoke(event: string, data: unknown) {
    const handler = handlers.get(event);
    assert.ok(handler, `handler ${event} 未注册`);
    let ackPayload: unknown;
    await handler(data, (payload: unknown) => {
      ackPayload = payload;
    });
    return ackPayload as Record<string, unknown>;
  }

  return { invoke, store, broadcasted, socketEmitted, getSaved: () => saved };
}

const presenter = { id: "7", name: "讲道者" };

test("连接时仅在展示激活时补发快照", async () => {
  const idle = createHarness();
  assert.equal(idle.socketEmitted.length, 0);

  const store = createSermonStateStore({
    persistence: { load: async () => null, save: async () => undefined },
    createId: () => "id-1"
  });
  await store.add(presenter, [
    {
      blocks: [{ type: "passage", reference: "约3:16", normalizedReference: "约翰福音 3:16", verseStart: 0, verseCount: 0 }],
      verses: [],
      source: "约3:16"
    }
  ]);
  await store.present(presenter, "id-1");

  const handlers = new Map<string, Handler>();
  const socketEmitted: Array<{ event: string; payload: unknown }> = [];
  const socket = {
    on: (event: string, handler: Handler) => {
      handlers.set(event, handler);
    },
    emit: (event: string, payload: unknown) => {
      socketEmitted.push({ event, payload });
    },
    data: {}
  } as unknown as Socket;
  registerSermonSocket({ emit: () => undefined }, socket, {
    refreshAuth: async () => ({ accountId: 7 }),
    presenterAccount: async () => null,
    store
  });
  assert.equal(socketEmitted.length, 1);
  assert.equal(socketEmitted[0].event, "sermon:state");
  assert.equal((socketEmitted[0].payload as SermonStateDTO).currentItemId, "id-1");
});

test("队列未激活时快照只补发给有讲道权限的连接", async () => {
  const store = createSermonStateStore({
    persistence: { load: async () => null, save: async () => undefined },
    createId: () => "id-1"
  });
  await store.add(presenter, [
    {
      blocks: [{ type: "passage", reference: "约3:16", normalizedReference: "约翰福音 3:16", verseStart: 0, verseCount: 0 }],
      verses: [],
      source: "约3:16"
    }
  ]);

  function connect(profile: SermonPresenterProfile | null) {
    const socketEmitted: Array<{ event: string; payload: unknown }> = [];
    const socket = {
      on: () => undefined,
      emit: (event: string, payload: unknown) => {
        socketEmitted.push({ event, payload });
      },
      data: {},
      connected: true
    } as unknown as Socket;
    registerSermonSocket({ emit: () => undefined }, socket, {
      refreshAuth: async () => ({ accountId: 7 }),
      presenterAccount: async () => profile,
      store
    });
    return socketEmitted;
  }

  const viewerEmitted = connect({ isAdmin: false, displayName: "观众", sermonPresenterUntil: null });
  const presenterEmitted = connect({ isAdmin: true, displayName: "讲道者", sermonPresenterUntil: null });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(viewerEmitted.length, 0, "观众端不补发未激活的队列");
  assert.equal(presenterEmitted.length, 1, "讲道者重连应收到未激活的队列快照");
  assert.equal((presenterEmitted[0].payload as SermonStateDTO).queue.length, 1);
});

test("无权限与认证失败均被拒绝且不广播", async () => {
  const denied = createHarness({ profile: { isAdmin: false, displayName: "甲", sermonPresenterUntil: null } });
  for (const [event, data] of [
    ["sermon:add", { slides: [{ blocks: [{ type: "reference", reference: "约3:16" }] }] }],
    ["sermon:update", { id: "id-1", slide: { blocks: [{ type: "text", content: "大纲" }] } }],
    ["sermon:scroll", { id: "id-1", lines: 1 }],
    ["sermon:add-text", { texts: [{ content: "大纲" }] }],
    ["sermon:reorder", { order: [] }],
    ["sermon:remove", { id: "id-1" }],
    ["sermon:present", { id: null }],
    ["sermon:display", { fontScale: 1.2 }],
    ["sermon:annotate", { itemId: "id-1", annotation: { verseIndex: 0, kind: "highlight" } }],
    ["sermon:annotate:clear", { itemId: "id-1" }],
    ["sermon:clear", {}]
  ] as Array<[string, unknown]>) {
    const ack = await denied.invoke(event, data);
    assert.equal(ack.ok, false, event);
  }
  assert.equal(denied.broadcasted.length, 0);
  assert.equal(denied.store.getState().queue.length, 0);

  const unauthenticated = createHarness({ auth: null });
  const ack = await unauthenticated.invoke("sermon:add", { slides: [{ blocks: [{ type: "reference", reference: "约3:16" }] }] });
  assert.equal(ack.ok, false);
  assert.equal(ack.message, "认证失败");
  assert.equal(unauthenticated.broadcasted.length, 0);
});

test("sermon:add 解析屏内容：识别经文、失败出处降级为文字并提示、成功后广播并持久化", async () => {
  const { invoke, store, broadcasted, getSaved } = createHarness();
  const ack = await invoke("sermon:add", {
    slides: [
      { blocks: [{ type: "reference", reference: "约3:16" }] },
      { blocks: [{ type: "reference", reference: "不存在的书 1:1" }] },
      { blocks: [{ type: "text", content: "大纲引言" }] }
    ]
  });
  assert.equal(ack.ok, true);
  assert.equal(ack.added, 3, "降级出处仍作为文字屏加入，不丢内容");
  const errors = ack.errors as Array<{ reference: string; message: string }>;
  assert.equal(errors.length, 1);
  assert.equal(errors[0].reference, "不存在的书 1:1");
  assert.match(errors[0].message, /已作为文字加入/);

  const state = store.getState();
  assert.equal(state.queue.length, 3);
  assert.equal(state.queue[0].normalizedReference, "约翰福音 3:16");
  assert.ok(state.queue[0].verses.length > 0);
  assert.deepEqual(state.queue[1].blocks, [{ type: "text", content: "不存在的书 1:1" }], "降级块原文保留");
  assert.equal(state.queue[1].kind, "text");
  assert.equal(state.queue[2].kind, "text");
  assert.equal(state.presenterId, "7");
  assert.equal(state.presenterName, "讲道者");
  assert.equal(broadcasted.length, 1);
  assert.equal(broadcasted[0].queue.length, 3);
  assert.ok(getSaved());

  const mixed = await invoke("sermon:add", {
    slides: [{ blocks: [{ type: "reference", reference: "诗篇23:1" }, { type: "text", content: "说明" }] }]
  });
  assert.equal(mixed.ok, true);
  const mixedItem = store.getState().queue[3];
  assert.equal(mixedItem.normalizedReference, "诗篇 23:1");
  assert.deepEqual(
    mixedItem.blocks?.map((block) => (block.type === "passage" ? [block.type, block.verseStart, block.verseCount] : block.type)),
    [["passage", 0, 1], "text"]
  );
});

test("sermon:add 非法 payload 被拒绝", async () => {
  const { invoke, broadcasted } = createHarness();
  assert.equal((await invoke("sermon:add", {})).ok, false);
  assert.equal((await invoke("sermon:add", { slides: [] })).ok, false);
  assert.equal((await invoke("sermon:add", { slides: [{ blocks: [] }] })).ok, false, "空块拒绝");
  assert.equal((await invoke("sermon:add", { slides: [{ blocks: [{ type: "text", content: "  " }] }] })).ok, false, "纯空白块拒绝");
  assert.equal(
    (await invoke("sermon:add", { slides: [{ blocks: [{ type: "text", content: "x".repeat(4001) }] }] })).ok,
    false,
    "超长文本块拒绝"
  );
  const tooManyRefs = {
    slides: [
      {
        blocks: Array.from({ length: 21 }, (_, index) => ({ type: "reference" as const, reference: `约3:${index + 1}` }))
      }
    ]
  };
  assert.equal((await invoke("sermon:add", tooManyRefs)).ok, false, "出处总数超限拒绝");
  assert.equal(broadcasted.length, 0);
});

test("sermon:update 热编辑：重解析当前屏、标注重置、未知条目拒绝", async () => {
  const { invoke, store, broadcasted } = createHarness();
  await invoke("sermon:add", { slides: [{ blocks: [{ type: "reference", reference: "约3:16" }] }] });
  const id = store.getState().queue[0].id;
  await invoke("sermon:present", { id });
  await invoke("sermon:annotate", { itemId: id, annotation: { verseIndex: 0, kind: "highlight" } });

  assert.equal((await invoke("sermon:update", { id: "missing", slide: { blocks: [{ type: "text", content: "x" }] } })).ok, false);
  assert.equal((await invoke("sermon:update", { id, slide: { blocks: [{ type: "text", content: "  " }] } })).ok, false, "空屏拒绝");
  assert.equal(broadcasted.length, 3, "add/present/annotate 各广播一次，两次拒绝不广播");

  const ack = await invoke("sermon:update", { id, slide: { blocks: [{ type: "reference", reference: "诗篇23:1" }] } });
  assert.equal(ack.ok, true);
  const item = store.getState().queue[0];
  assert.equal(item.id, id, "id 不变，观众停留在同一屏");
  assert.equal(item.normalizedReference, "诗篇 23:1");
  assert.deepEqual(item.annotations, [], "经节变化，标注重置");
  assert.equal(item.scrollLines, 0);
  assert.equal(store.getState().currentItemId, id);
  assert.equal(broadcasted.length, 4, "热编辑保存后广播");
});

test("sermon:scroll 同步屏内滚动：夹取行数并广播，非法值与未知条目拒绝", async () => {
  const { invoke, store, broadcasted } = createHarness();
  await invoke("sermon:add", { slides: [{ blocks: [{ type: "reference", reference: "约3:16" }] }] });
  const id = store.getState().queue[0].id;

  assert.equal((await invoke("sermon:scroll", { id: "missing", lines: 1 })).ok, false);
  assert.equal((await invoke("sermon:scroll", { id, lines: -1 })).ok, false, "负值拒绝");
  assert.equal((await invoke("sermon:scroll", { id, lines: 1.5 })).ok, false, "非整数拒绝");
  assert.equal(broadcasted.length, 1, "add 广播一次，拒绝不广播");

  const ack = await invoke("sermon:scroll", { id, lines: 3 });
  assert.equal(ack.ok, true);
  assert.equal(store.getState().queue[0].scrollLines, 3);
  assert.equal(broadcasted.length, 2);
  assert.equal(broadcasted[1].queue[0].scrollLines, 3, "广播带最新滚动位置");
});

test("sermon:add-text 校验载荷、剔除控制字符、成功后广播并持久化", async () => {
  const { invoke, store, broadcasted, getSaved } = createHarness();

  assert.equal((await invoke("sermon:add-text", {})).ok, false, "缺 texts 拒绝");
  assert.equal((await invoke("sermon:add-text", { texts: [] })).ok, false, "空数组拒绝");
  assert.equal((await invoke("sermon:add-text", { texts: [{ content: "" }] })).ok, false, "空正文拒绝");
  assert.equal((await invoke("sermon:add-text", { texts: [{ content: "   " }] })).ok, false, "纯空白正文拒绝");
  assert.equal((await invoke("sermon:add-text", { texts: [{ content: "a".repeat(4001) }] })).ok, false, "超长正文拒绝");
  assert.equal((await invoke("sermon:add-text", { texts: [{ title: "t".repeat(101), content: "正文" }] })).ok, false, "超长标题拒绝");
  assert.equal((await invoke("sermon:add-text", { texts: [{ content: 42 }] })).ok, false, "非字符串正文拒绝");
  assert.equal(broadcasted.length, 0);

  const ack = await invoke("sermon:add-text", { texts: [{ title: "大纲\u000B", content: "一、引言\n\n二、正文" }] });
  assert.equal(ack.ok, true);
  assert.equal(ack.added, 1);
  const item = store.getState().queue[0];
  assert.equal(item.kind, "text");
  assert.equal(item.title, "大纲", "标题控制字符被剔除并 trim");
  assert.equal(item.content, "一、引言\n\n二、正文", "正文保留换行");
  assert.equal(broadcasted.length, 1);
  assert.ok(getSaved(), "成功后应持久化");
});

test("队列操作：present / reorder / annotate / annotate:clear / remove / clear", async () => {
  const { invoke, store, broadcasted } = createHarness();
  await invoke("sermon:add", {
    slides: [{ blocks: [{ type: "reference", reference: "约3:16" }] }, { blocks: [{ type: "reference", reference: "诗篇23" }] }]
  });
  const [first, second] = store.getState().queue;

  assert.equal((await invoke("sermon:present", { id: "missing" })).ok, false);
  const presented = await invoke("sermon:present", { id: first.id });
  assert.equal(presented.ok, true);
  assert.equal(store.getState().active, true);
  assert.equal(store.getState().currentItemId, first.id);

  const annotated = await invoke("sermon:annotate", {
    itemId: first.id,
    annotation: { verseIndex: 0, kind: "highlight" }
  });
  assert.equal(annotated.ok, true);
  assert.equal(store.getState().queue[0].annotations.length, 1);

  const clearedAnnotation = await invoke("sermon:annotate:clear", { itemId: first.id, kind: "highlight" });
  assert.equal(clearedAnnotation.ok, true);
  assert.equal(store.getState().queue[0].annotations.length, 0);

  const reordered = await invoke("sermon:reorder", { order: [second.id, first.id] });
  assert.equal(reordered.ok, true);
  assert.deepEqual(store.getState().queue.map((item) => item.id), [second.id, first.id]);

  const removed = await invoke("sermon:remove", { id: first.id });
  assert.equal(removed.ok, true);
  assert.equal(store.getState().currentItemId, null);
  assert.equal(store.getState().active, false);

  const cleared = await invoke("sermon:clear", {});
  assert.equal(cleared.ok, true);
  assert.equal(store.getState().queue.length, 0);
  // add + present + annotate + annotate:clear + reorder + remove + clear
  assert.equal(broadcasted.length, 7);
});

test("sermon:display 校验载荷、合并显示设置、持久化并广播", async () => {
  const { invoke, store, broadcasted, getSaved } = createHarness();
  assert.equal(store.getState().display.fontScale, 1);

  assert.equal((await invoke("sermon:display", {})).ok, false, "空补丁拒绝");
  assert.equal((await invoke("sermon:display", { fontScale: 2 })).ok, false, "倍率超出上限拒绝");
  assert.equal((await invoke("sermon:display", { fontScale: 0.5 })).ok, false, "倍率低于下限拒绝");
  assert.equal((await invoke("sermon:display", { marginPct: 1 })).ok, false, "边距低于下限拒绝");
  assert.equal((await invoke("sermon:display", { marginPct: 21 })).ok, false, "边距高于上限拒绝");
  assert.equal((await invoke("sermon:display", { fontFamily: "serif" })).ok, false, "非法字体族拒绝");
  assert.equal((await invoke("sermon:display", { background: "red" })).ok, false, "非法背景拒绝");
  assert.equal((await invoke("sermon:display", { background: "#fff" })).ok, false, "非 6 位 hex 拒绝");
  assert.equal((await invoke("sermon:display", { fontScale: 1.2, zoom: 2 })).ok, false, "未知键拒绝");
  assert.equal(broadcasted.length, 0);

  const ack = await invoke("sermon:display", { fontScale: 1.2, fontFamily: "songti", marginPct: 8, background: "#123456" });
  assert.equal(ack.ok, true);
  assert.deepEqual(store.getState().display, { fontFamily: "songti", fontScale: 1.2, marginPct: 8, background: "#123456" });
  assert.equal(broadcasted.length, 1);
  assert.equal(broadcasted[0].display.fontScale, 1.2);
  assert.ok(getSaved(), "成功后应持久化");

  const merged = await invoke("sermon:display", { background: "midnight" });
  assert.equal(merged.ok, true);
  assert.deepEqual(store.getState().display, { fontFamily: "songti", fontScale: 1.2, marginPct: 8, background: "midnight" }, "部分补丁合并");
  assert.equal(broadcasted.length, 2);

  const reload = createSermonStateStore({
    persistence: { load: async () => getSaved(), save: async () => undefined }
  });
  assert.deepEqual(
    (await reload.load()).display,
    { fontFamily: "songti", fontScale: 1.2, marginPct: 8, background: "midnight" },
    "重新加载后保留显示设置"
  );
});
