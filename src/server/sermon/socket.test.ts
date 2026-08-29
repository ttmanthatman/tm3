import assert from "node:assert/strict";
import test from "node:test";
import type { Socket } from "socket.io";
import type { SermonEndedEvent, SermonInvitedEvent, SermonPresentationSummaryDTO, SermonRemovedEvent, SermonStateDTO } from "../../shared/types.js";
import { createSermonPresentationService } from "./presentations.js";
import { registerSermonSocket } from "./socket.js";

type Ack = (payload: unknown) => void;
type Handler = (data: unknown, ack?: Ack) => Promise<void>;

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createHarness(options: { grantIds?: number[] } = {}) {
  const grants = new Set(options.grantIds ?? []);
  const settings = new Map<string, string>();
  let counter = 0;
  // 1 为管理员；2—99 为普通注册用户（grants 内有集会授权）；其余账号不存在。
  const profileFor = (accountId: number) => {
    if (accountId === 1) return { isAdmin: true, displayName: "管理员", sermonPresenterUntil: null };
    if (accountId >= 2 && accountId < 100) {
      return {
        isAdmin: false,
        displayName: `用户${accountId}`,
        sermonPresenterUntil: grants.has(accountId) ? new Date("9999-12-31T23:59:59.999Z") : null
      };
    }
    return null;
  };
  const service = createSermonPresentationService({
    loadSetting: async (key) => settings.get(key) ?? null,
    saveSetting: async (key, value) => {
      settings.set(key, value);
    },
    deleteSetting: async (key) => {
      settings.delete(key);
    },
    listSettingKeys: async (prefix) => [...settings.keys()].filter((key) => key.startsWith(prefix)),
    presenterAccount: async (accountId) => profileFor(accountId),
    accountExists: async (accountId) => accountId >= 1 && accountId < 100,
    createId: () => `id-${++counter}`,
    now: () => new Date("2026-08-27T12:00:00.000Z")
  });

  const roomEmissions: Array<{ room: string; event: string; payload: unknown }> = [];
  const globalEmissions: Array<{ event: string; payload: unknown }> = [];
  const forcedLeaves: Array<{ accountId: number; room: string }> = [];
  const io = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        roomEmissions.push({ room, event, payload });
      }
    }),
    emit: (event: string, payload: unknown) => {
      globalEmissions.push({ event, payload });
    }
  };

  function connect(accountId: number) {
    const handlers = new Map<string, Handler>();
    const socketEmitted: Array<{ event: string; payload: unknown }> = [];
    const joined: string[] = [];
    const left: string[] = [];
    const socket = {
      on: (event: string, handler: Handler) => {
        handlers.set(event, handler);
      },
      emit: (event: string, payload: unknown) => {
        socketEmitted.push({ event, payload });
      },
      join: (room: string) => {
        joined.push(room);
      },
      leave: (room: string) => {
        left.push(room);
      },
      data: {},
      connected: true
    } as unknown as Socket;
    registerSermonSocket(io, socket, {
      refreshAuth: async () => ({ accountId }),
      presenterAccount: async (id) => profileFor(id),
      service,
      socketsLeave: (id, room) => {
        forcedLeaves.push({ accountId: id, room });
      }
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
    return { invoke, socketEmitted, joined, left };
  }

  return { service, connect, roomEmissions, globalEmissions, forcedLeaves };
}

test("sermon:start 小组：ack、入房、房间状态广播、目录全局广播、受邀者定向通知", async () => {
  const { connect, roomEmissions, globalEmissions } = createHarness();
  const socket = connect(7);

  assert.equal((await socket.invoke("sermon:start", { scope: "group", invitedAccountIds: [9, 10] })).ok, true);
  assert.deepEqual(socket.joined, ["sermon:7"], "发起后加入自己的演示房间");

  const stateEmit = roomEmissions.find((entry) => entry.room === "sermon:7" && entry.event === "sermon:state");
  assert.ok(stateEmit);
  assert.equal((stateEmit.payload as SermonStateDTO).scope, "group");
  assert.equal((stateEmit.payload as SermonStateDTO).presenterId, "7");

  const invited = roomEmissions.filter((entry) => entry.event === "sermon:invited");
  assert.deepEqual(
    invited.map((entry) => entry.room).sort(),
    ["acct:10", "acct:9"],
    "邀请定向推送到受邀账号房间"
  );
  assert.deepEqual(invited[0].payload as SermonInvitedEvent, { presenterId: 7, presenterName: "用户7", scope: "group" });

  const directory = globalEmissions.filter((entry) => entry.event === "sermon:directory");
  assert.equal(directory.length, 1);
  assert.deepEqual((directory[0].payload as SermonPresentationSummaryDTO[]).map((entry) => entry.presenterId), [7]);
  assert.equal(roomEmissions.some((entry) => entry.event === "sermon:directory"), false, "目录走全局 emit 而非房间");
});

test("sermon:start 集会：无授权拒绝；有授权通过；参数非法拒绝", async () => {
  const denied = createHarness();
  const deniedAck = await denied.connect(7).invoke("sermon:start", { scope: "assembly" });
  assert.equal(deniedAck.ok, false);
  assert.equal(deniedAck.message, "无集会讲道授权，仅可发起小组演示");
  assert.equal(denied.globalEmissions.length, 0, "拒绝后无广播");

  const allowed = createHarness({ grantIds: [8] });
  assert.equal((await allowed.connect(8).invoke("sermon:start", { scope: "assembly" })).ok, true);
  assert.equal(allowed.service.get(8)?.scope, "assembly");

  const bad = createHarness();
  assert.equal((await bad.connect(7).invoke("sermon:start", { scope: "public" })).ok, false, "非法 scope 拒绝");
  assert.equal((await bad.connect(7).invoke("sermon:start", {})).ok, false, "缺 scope 拒绝");
  assert.equal(bad.globalEmissions.length, 0);
});

test("sermon:start 幂等：重复发起返回已有演示", async () => {
  const { connect, service } = createHarness();
  const socket = connect(7);
  await socket.invoke("sermon:start", { scope: "group", invitedAccountIds: [9] });
  const again = await socket.invoke("sermon:start", { scope: "assembly" });
  assert.equal(again.ok, true);
  assert.equal(service.get(7)?.scope, "group", "范围不被重复发起覆盖");
});

test("sermon:join：小组需受邀、集会全员可加入、激活后收到快照", async () => {
  const { connect, service, roomEmissions } = createHarness({ grantIds: [8] });
  const presenter = connect(7);
  await presenter.invoke("sermon:start", { scope: "group", invitedAccountIds: [9] });
  await presenter.invoke("sermon:add", { slides: [{ blocks: [{ type: "reference", reference: "约3:16" }] }] });
  const itemId = service.get(7)?.store.getState().queue[0]?.id;
  await presenter.invoke("sermon:present", { id: itemId });
  const previews = roomEmissions.filter(
    (entry) => entry.event === "sermon:preview" && (entry.payload as { preview: unknown }).preview !== null
  );
  assert.deepEqual(previews.map((entry) => entry.room), ["acct:9"], "小组预览只定向推送给受邀账号");
  assert.equal((previews[0].payload as { preview: { item: { id: string } | null } }).preview.item?.id, itemId);

  const stranger = connect(10);
  const denied = await stranger.invoke("sermon:join", { presenterId: 7 });
  assert.equal(denied.ok, false);
  assert.equal(denied.message, "该演示仅受邀账号可加入");

  const viewer = connect(9);
  const joined = await viewer.invoke("sermon:join", { presenterId: 7 });
  assert.equal(joined.ok, true);
  assert.deepEqual(viewer.joined, ["sermon:7"]);
  const snapshot = viewer.socketEmitted.find((entry) => entry.event === "sermon:state");
  assert.ok(snapshot, "入座后收到激活快照");
  assert.equal((snapshot.payload as SermonStateDTO).active, true);

  // 集会演示：未受邀账号也可加入
  const assemblyPresenter = connect(8);
  await assemblyPresenter.invoke("sermon:start", { scope: "assembly" });
  assert.equal((await connect(10).invoke("sermon:join", { presenterId: 8 })).ok, true, "集会全员可加入");

  assert.equal((await connect(9).invoke("sermon:join", { presenterId: 404 })).ok, false, "演示不存在拒绝");
  assert.equal((await connect(9).invoke("sermon:join", {})).ok, false, "参数非法拒绝");
});

test("sermon:join 互斥：seated-elsewhere 拒绝码；leave + join 一键换席", async () => {
  const { connect, service } = createHarness();
  await connect(7).invoke("sermon:start", { scope: "group", invitedAccountIds: [9] });
  await connect(8).invoke("sermon:start", { scope: "group", invitedAccountIds: [9] });

  const viewer = connect(9);
  assert.equal((await viewer.invoke("sermon:join", { presenterId: 7 })).ok, true);
  assert.equal(service.seatOf(9), 7);

  const conflict = await viewer.invoke("sermon:join", { presenterId: 8 });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, "seated-elsewhere");
  assert.equal(conflict.message, "你已在观看其他演示，请先离开再加入");
  assert.equal(service.seatOf(9), 7, "拒绝后仍在原席");

  assert.equal((await viewer.invoke("sermon:leave", {})).ok, true);
  assert.deepEqual(viewer.left, ["sermon:7"], "leave 离开原演示房间");
  assert.equal((await viewer.invoke("sermon:join", { presenterId: 8 })).ok, true, "换席成功");
  assert.equal(service.seatOf(9), 8);
});

test("sermon:invite：仅主持人、校验账号存在与未入座他席、定向通知与目录更新", async () => {
  const { connect, roomEmissions, globalEmissions } = createHarness();
  const nobody = connect(7);
  const noPresentation = await nobody.invoke("sermon:invite", { accountIds: [9] });
  assert.equal(noPresentation.ok, false);
  assert.equal(noPresentation.message, "请先开始演示");

  await nobody.invoke("sermon:start", { scope: "group" });
  assert.equal((await nobody.invoke("sermon:invite", { accountIds: [999] })).ok, false, "账号不存在拒绝");
  assert.equal((await nobody.invoke("sermon:invite", { accountIds: [] })).ok, false, "空名单拒绝");

  await connect(8).invoke("sermon:start", { scope: "group", invitedAccountIds: [9] });
  await connect(9).invoke("sermon:join", { presenterId: 8 });
  const seatedElsewhere = await nobody.invoke("sermon:invite", { accountIds: [9] });
  assert.equal(seatedElsewhere.ok, false);
  assert.equal(seatedElsewhere.message, "所选账号已在观看其他演示");

  const ack = await nobody.invoke("sermon:invite", { accountIds: [10, 11] });
  assert.equal(ack.ok, true);
  assert.equal(ack.added, 2);
  const invited = roomEmissions.filter((entry) => entry.event === "sermon:invited" && entry.room !== "acct:9");
  assert.deepEqual(invited.map((entry) => entry.room).sort(), ["acct:10", "acct:11"]);
  const directory = globalEmissions[globalEmissions.length - 1];
  assert.equal(directory.event, "sermon:directory");
  assert.deepEqual((directory.payload as SermonPresentationSummaryDTO[])[0].invitedAccountIds, [10, 11]);
});

test("sermon:plans：保存、列出、载入与删除命名队列方案", async () => {
  const { connect, service, roomEmissions } = createHarness();
  const presenter = connect(7);
  await presenter.invoke("sermon:start", { scope: "group" });
  await presenter.invoke("sermon:add", { slides: [{ blocks: [{ type: "text", content: "预备内容" }] }] });

  const saved = await presenter.invoke("sermon:plan-save", { title: "8月30日分享" });
  assert.equal(saved.ok, true);
  const plans = saved.plans as Array<{ id: string; title: string; queue: unknown[] }>;
  assert.equal(plans[0].title, "8月30日分享");
  assert.equal(plans[0].queue.length, 1);

  const listed = await presenter.invoke("sermon:plans", {});
  assert.deepEqual(listed.plans, saved.plans);
  await presenter.invoke("sermon:clear", {});
  const loaded = await presenter.invoke("sermon:plan-load", { id: plans[0].id });
  assert.equal(loaded.ok, true);
  assert.equal(service.get(7)?.store.getState().queue[0].source, "预备内容");
  assert.ok(roomEmissions.some((entry) => entry.room === "sermon:7" && entry.event === "sermon:state"), "载入后同步本人所有连接");

  const deleted = await presenter.invoke("sermon:plan-delete", { id: plans[0].id });
  assert.deepEqual(deleted.plans, []);
  assert.equal((await presenter.invoke("sermon:plan-save", { title: "" })).ok, false, "空标题拒绝");
});

test("sermon:remove-viewer：主持人移除观众、定向通知、强制离房", async () => {
  const { connect, roomEmissions, forcedLeaves } = createHarness();
  await connect(7).invoke("sermon:start", { scope: "group", invitedAccountIds: [9] });
  await connect(9).invoke("sermon:join", { presenterId: 7 });

  const notSeated = await connect(7).invoke("sermon:remove-viewer", { accountId: 66 });
  assert.equal(notSeated.ok, false);
  assert.equal(notSeated.message, "该账号不在观众席中");

  const ack = await connect(7).invoke("sermon:remove-viewer", { accountId: 9 });
  assert.equal(ack.ok, true);
  const removed = roomEmissions.find((entry) => entry.event === "sermon:removed");
  assert.equal(removed?.room, "acct:9");
  assert.deepEqual(removed?.payload as SermonRemovedEvent, { presenterId: 7, presenterName: "用户7" });
  assert.deepEqual(forcedLeaves, [{ accountId: 9, room: "sermon:7" }], "被移除者全部 socket 离房");
});

test("sermon:end：房间内广播最终状态、通知观众与受邀者、全员离房、目录清空", async () => {
  const { connect, service, roomEmissions, globalEmissions, forcedLeaves } = createHarness();
  await connect(7).invoke("sermon:start", { scope: "group", invitedAccountIds: [9, 10] });
  await connect(9).invoke("sermon:join", { presenterId: 7 });

  const presenterSocket = connect(7);
  const ack = await presenterSocket.invoke("sermon:end", {});
  assert.equal(ack.ok, true);

  const finalState = roomEmissions.filter((entry) => entry.room === "sermon:7" && entry.event === "sermon:state");
  assert.ok(finalState.length > 0, "房间内广播最终状态");
  assert.equal((finalState[finalState.length - 1].payload as SermonStateDTO).active, false);

  const ended = roomEmissions.filter((entry) => entry.event === "sermon:ended");
  assert.deepEqual(ended.map((entry) => entry.room).sort(), ["acct:10", "acct:9"], "观众与受邀者都收到结束通知");
  assert.deepEqual(ended[0].payload as SermonEndedEvent, { presenterId: 7, presenterName: "用户7" });

  assert.ok(forcedLeaves.some((entry) => entry.accountId === 9 && entry.room === "sermon:7"), "观众离房");
  assert.ok(forcedLeaves.some((entry) => entry.accountId === 7 && entry.room === "sermon:7"), "主持人账号离房");
  assert.deepEqual(presenterSocket.left, ["sermon:7"]);
  assert.equal(service.get(7), undefined);
  assert.deepEqual((globalEmissions[globalEmissions.length - 1].payload as SermonPresentationSummaryDTO[]), [], "目录清空");

  // 结束后变更事件不再可用
  const afterEnd = await presenterSocket.invoke("sermon:add", { slides: [{ blocks: [{ type: "text", content: "x" }] }] });
  assert.equal(afterEnd.ok, false);
  assert.equal(afterEnd.message, "请先开始演示");
});

test("sermon:end 强制结束：管理员可结束他人演示，非管理员拒绝", async () => {
  const { connect } = createHarness();
  await connect(7).invoke("sermon:start", { scope: "group" });

  const denied = await connect(8).invoke("sermon:end", { presenterId: 7 });
  assert.equal(denied.ok, false);
  assert.equal(denied.message, "需要管理员权限才能结束他人的演示");

  const byAdmin = await connect(1).invoke("sermon:end", { presenterId: 7 });
  assert.equal(byAdmin.ok, true);
});

test("变更事件操作自己的演示：无演示拒绝、广播仅到房间、ack 形状保持", async () => {
  const { connect, roomEmissions, globalEmissions } = createHarness();
  const socket = connect(7);

  const events: Array<[string, unknown]> = [
    ["sermon:add", { slides: [{ blocks: [{ type: "reference", reference: "约3:16" }] }] }],
    ["sermon:update", { id: "id-1", slide: { blocks: [{ type: "text", content: "大纲" }] } }],
    ["sermon:scroll", { id: "id-1", lines: 1 }],
    ["sermon:layout", { id: "id-1", paragraph: false }],
    ["sermon:add-text", { texts: [{ content: "引言" }] }],
    ["sermon:reorder", { order: [] }],
    ["sermon:remove", { id: "id-1" }],
    ["sermon:present", { id: null }],
    ["sermon:display", { fontScale: 1.2 }],
    ["sermon:annotate", { itemId: "id-1", annotation: { verseIndex: 0, kind: "highlight" } }],
    ["sermon:annotate:clear", { itemId: "id-1" }],
    ["sermon:clear", {}]
  ];
  for (const [event, data] of events) {
    const ack = await socket.invoke(event, data);
    assert.equal(ack.ok, false, `${event} 无演示时应拒绝`);
    assert.equal(ack.message, "请先开始演示");
  }
  assert.equal(roomEmissions.length, 0);
  assert.equal(globalEmissions.length, 0);

  await socket.invoke("sermon:start", { scope: "group" });
  const addAck = await socket.invoke("sermon:add", {
    slides: [{ blocks: [{ type: "reference", reference: "约3:16" }] }, { blocks: [{ type: "text", content: "大纲" }] }]
  });
  assert.equal(addAck.ok, true);
  assert.equal(addAck.added, 2);
  const stateEmits = roomEmissions.filter((entry) => entry.event === "sermon:state");
  assert.equal(stateEmits.length, 2, "start 与 add 各广播一次状态");
  assert.ok(stateEmits.every((entry) => entry.room === "sermon:7"), "状态只发到自己的演示房间");
  assert.equal(globalEmissions.filter((entry) => entry.event === "sermon:state").length, 0, "状态不做全局广播");
  assert.equal(globalEmissions.filter((entry) => entry.event === "sermon:directory").length, 1, "仅 start 触发目录广播");
});

test("sermon:layout 只更新指定幻灯片并校验非空补丁", async () => {
  const { connect, service } = createHarness();
  const presenter = connect(7);
  await presenter.invoke("sermon:start", { scope: "group" });
  await presenter.invoke("sermon:add", { slides: [{ blocks: [{ type: "reference", reference: "约3:16" }] }] });
  const id = service.get(7)?.store.getState().queue[0].id;
  assert.ok(id);

  assert.equal((await presenter.invoke("sermon:layout", { id, paragraph: false, centered: true })).ok, true);
  assert.deepEqual(service.get(7)?.store.getState().queue[0].layout, { paragraph: false, centered: true });
  assert.equal((await presenter.invoke("sermon:layout", { id })).ok, false, "空补丁拒绝");
  assert.equal((await presenter.invoke("sermon:layout", { id: "missing", centered: false })).ok, false, "未知页面拒绝");
});

test("两个讲道者并发：互不可见对方队列与广播", async () => {
  const { connect, service, roomEmissions } = createHarness();
  const first = connect(7);
  const second = connect(8);
  await first.invoke("sermon:start", { scope: "group" });
  await second.invoke("sermon:start", { scope: "group" });
  roomEmissions.length = 0;

  await first.invoke("sermon:add", { slides: [{ blocks: [{ type: "text", content: "甲的屏" }] }] });
  await second.invoke("sermon:add", { slides: [{ blocks: [{ type: "text", content: "乙的屏" }] }] });

  const firstState = roomEmissions.filter((entry) => entry.room === "sermon:7" && entry.event === "sermon:state");
  const secondState = roomEmissions.filter((entry) => entry.room === "sermon:8" && entry.event === "sermon:state");
  assert.equal(firstState.length, 1);
  assert.equal(secondState.length, 1);
  assert.deepEqual((firstState[0].payload as SermonStateDTO).queue.map((item) => item.source), ["甲的屏"]);
  assert.deepEqual((secondState[0].payload as SermonStateDTO).queue.map((item) => item.source), ["乙的屏"]);
  assert.deepEqual(service.directory().map((entry) => entry.presenterId), [7, 8]);
});

test("连接快照：主持人补发完整状态（含未激活队列），已入座观众补发激活状态，无关连接无快照", async () => {
  const { connect, service } = createHarness();
  const presenter = connect(7);
  await presenter.invoke("sermon:start", { scope: "group", invitedAccountIds: [9] });
  await presenter.invoke("sermon:add", { slides: [{ blocks: [{ type: "text", content: "大纲" }] }] });

  // 主持人另一个 socket 重连：拿到未激活队列
  const presenterReconnect = connect(7);
  await flush();
  assert.deepEqual(presenterReconnect.joined, ["sermon:7"]);
  const ownSnapshot = presenterReconnect.socketEmitted.find((entry) => entry.event === "sermon:state");
  assert.ok(ownSnapshot, "主持人重连补发队列");
  assert.equal((ownSnapshot.payload as SermonStateDTO).queue.length, 1);
  assert.equal((ownSnapshot.payload as SermonStateDTO).active, false);

  // 观众未入座：无快照
  const outsider = connect(10);
  await flush();
  assert.equal(outsider.socketEmitted.length, 0, "无关连接不补发");
  assert.deepEqual(outsider.joined, []);

  // 观众入座且演示激活：另一个 socket 重连补发激活状态
  await presenter.invoke("sermon:present", { id: service.get(7)?.store.getState().queue[0]?.id ?? null });
  await connect(9).invoke("sermon:join", { presenterId: 7 });
  const viewerReconnect = connect(9);
  await flush();
  assert.deepEqual(viewerReconnect.joined, ["sermon:7"], "入座观众重连自动回房");
  const viewerSnapshot = viewerReconnect.socketEmitted.find((entry) => entry.event === "sermon:state");
  assert.ok(viewerSnapshot);
  assert.equal((viewerSnapshot.payload as SermonStateDTO).active, true);
});

test("连接快照：账号同时主持自己的讲道台并观看他人时，两份状态分别补发", async () => {
  const { connect, service } = createHarness();
  const own = connect(7);
  await own.invoke("sermon:start", { scope: "group" });
  await own.invoke("sermon:add", { slides: [{ blocks: [{ type: "text", content: "自己的预备" }] }] });

  const other = connect(8);
  await other.invoke("sermon:start", { scope: "group", invitedAccountIds: [7] });
  await other.invoke("sermon:add", { slides: [{ blocks: [{ type: "text", content: "他人的直播" }] }] });
  await other.invoke("sermon:present", { id: service.get(8)?.store.getState().queue[0].id });
  await own.invoke("sermon:join", { presenterId: 8 });

  const reconnect = connect(7);
  await flush();
  assert.deepEqual(reconnect.joined.sort(), ["sermon:7", "sermon:8"]);
  const presenters = reconnect.socketEmitted
    .filter((entry) => entry.event === "sermon:state")
    .map((entry) => (entry.payload as SermonStateDTO).presenterId)
    .sort();
  assert.deepEqual(presenters, ["7", "8"]);
});

test("认证失败：所有事件拒绝且不广播", async () => {
  const settings = new Map<string, string>();
  let counter = 0;
  const service = createSermonPresentationService({
    loadSetting: async (key) => settings.get(key) ?? null,
    saveSetting: async (key, value) => {
      settings.set(key, value);
    },
    deleteSetting: async () => undefined,
    listSettingKeys: async () => [],
    presenterAccount: async () => null,
    accountExists: async () => true,
    createId: () => `id-${++counter}`,
    now: () => new Date("2026-08-27T12:00:00.000Z")
  });
  const handlers = new Map<string, Handler>();
  const ioEmissions: string[] = [];
  const socket = {
    on: (event: string, handler: Handler) => {
      handlers.set(event, handler);
    },
    emit: () => undefined,
    join: () => undefined,
    leave: () => undefined,
    data: {}
  } as unknown as Socket;
  registerSermonSocket(
    {
      to: () => ({ emit: () => undefined }),
      emit: (event: string) => {
        ioEmissions.push(event);
      }
    },
    socket,
    {
      refreshAuth: async () => null,
      presenterAccount: async () => null,
      service,
      socketsLeave: () => undefined
    }
  );
  for (const event of ["sermon:start", "sermon:join", "sermon:invite", "sermon:end", "sermon:add", "sermon:clear", "sermon:plans", "sermon:plan-delete"]) {
    const handler = handlers.get(event);
    assert.ok(handler);
    let ackPayload: unknown;
    await handler({}, (payload: unknown) => {
      ackPayload = payload;
    });
    assert.deepEqual(ackPayload, { ok: false, message: "认证失败" }, event);
  }
  assert.equal(ioEmissions.length, 0);
});
