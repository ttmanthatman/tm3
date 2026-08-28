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
  await store.add(presenter, [{ reference: "约3:16", normalizedReference: "约翰福音 3:16", verses: [] }]);
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
  await store.add(presenter, [{ reference: "约3:16", normalizedReference: "约翰福音 3:16", verses: [] }]);

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
    ["sermon:add", { references: ["约3:16"] }],
    ["sermon:reorder", { order: [] }],
    ["sermon:remove", { id: "id-1" }],
    ["sermon:present", { id: null }],
    ["sermon:font-scale", { scale: 1.2 }],
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
  const ack = await unauthenticated.invoke("sermon:add", { references: ["约3:16"] });
  assert.equal(ack.ok, false);
  assert.equal(ack.message, "认证失败");
  assert.equal(unauthenticated.broadcasted.length, 0);
});

test("sermon:add 解析经文、收集失败项、成功后广播并持久化", async () => {
  const { invoke, store, broadcasted, getSaved } = createHarness();
  const ack = await invoke("sermon:add", { references: ["约3:16", "不存在的书 1:1", "诗篇23"] });
  assert.equal(ack.ok, true);
  assert.equal(ack.added, 2);
  assert.equal((ack.errors as unknown[]).length, 1);

  const state = store.getState();
  assert.equal(state.queue.length, 2);
  assert.equal(state.queue[0].normalizedReference, "约翰福音 3:16");
  assert.ok(state.queue[0].verses.length > 0);
  assert.equal(state.presenterId, "7");
  assert.equal(state.presenterName, "讲道者");
  assert.equal(broadcasted.length, 1);
  assert.equal(broadcasted[0].queue.length, 2);
  assert.ok(getSaved());

  const allFailed = await invoke("sermon:add", { references: ["火星书 1:1"] });
  assert.equal(allFailed.ok, false);
  assert.equal(broadcasted.length, 1);
});

test("sermon:add 非法 payload 被拒绝", async () => {
  const { invoke, broadcasted } = createHarness();
  assert.equal((await invoke("sermon:add", {})).ok, false);
  assert.equal((await invoke("sermon:add", { references: [] })).ok, false);
  assert.equal((await invoke("sermon:add", { references: ["", "   "] })).ok, false);
  assert.equal(broadcasted.length, 0);
});

test("队列操作：present / reorder / annotate / annotate:clear / remove / clear", async () => {
  const { invoke, store, broadcasted } = createHarness();
  await invoke("sermon:add", { references: ["约3:16", "诗篇23"] });
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

test("sermon:font-scale 校验范围、持久化并广播", async () => {
  const { invoke, store, broadcasted, getSaved } = createHarness();
  assert.equal(store.getState().fontScale, 1);

  assert.equal((await invoke("sermon:font-scale", {})).ok, false, "缺 scale 拒绝");
  assert.equal((await invoke("sermon:font-scale", { scale: 2 })).ok, false, "超出上限拒绝");
  assert.equal((await invoke("sermon:font-scale", { scale: 0.5 })).ok, false, "低于下限拒绝");
  assert.equal(broadcasted.length, 0);

  const ack = await invoke("sermon:font-scale", { scale: 1.2 });
  assert.equal(ack.ok, true);
  assert.equal(store.getState().fontScale, 1.2);
  assert.equal(broadcasted.length, 1);
  assert.equal(broadcasted[0].fontScale, 1.2);
  assert.ok(getSaved(), "成功后应持久化");

  const reload = createSermonStateStore({
    persistence: { load: async () => getSaved(), save: async () => undefined }
  });
  assert.equal((await reload.load()).fontScale, 1.2, "重新加载后保留倍率");
});
