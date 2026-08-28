import assert from "node:assert/strict";
import test from "node:test";
import { applyAdd, deserializeSermonState, emptySermonState, serializeSermonState, type SermonMutationContext } from "./state.js";
import {
  SERMON_LEGACY_SETTING_KEY,
  SermonPresentationError,
  SermonSeatConflictError,
  createSermonPresentationService,
  sermonSettingKeyFor,
  type SermonPresentationServiceDeps
} from "./presentations.js";

const NOW = "2026-08-27T12:00:00.000Z";

function slideContext(): SermonMutationContext {
  let counter = 0;
  return { actor: { id: "7", name: "讲道者" }, createId: () => `id-${++counter}`, now: NOW };
}

/** 构造一屏持久化状态（可指定 scope；缺省按当前默认小组）。 */
function persistedState(scope?: "group" | "assembly", presenterId = "7"): string {
  const state = applyAdd(emptySermonState(), [
    {
      blocks: [{ type: "passage", reference: "约3:16", normalizedReference: "约翰福音 3:16", verseStart: 0, verseCount: 1 }],
      verses: [{ book: "约翰福音", chapter: 3, verse: 16, endVerse: 16, reference: "约翰福音 3:16", text: "神爱世人" }],
      source: "约3:16"
    }
  ], slideContext());
  const raw = JSON.parse(serializeSermonState({ ...state, presenterId, presenterName: "讲道者" })) as Record<string, unknown>;
  if (scope === undefined) delete raw.scope;
  else raw.scope = scope;
  return JSON.stringify(raw);
}

function createHarness(options: { grantIds?: number[] } = {}) {
  const grants = new Set(options.grantIds ?? []);
  const settings = new Map<string, string>();
  const saves: Array<{ key: string; value: string }> = [];
  const deletions: string[] = [];
  let counter = 0;
  const deps: SermonPresentationServiceDeps = {
    loadSetting: async (key) => settings.get(key) ?? null,
    saveSetting: async (key, value) => {
      saves.push({ key, value });
      settings.set(key, value);
    },
    deleteSetting: async (key) => {
      deletions.push(key);
      settings.delete(key);
    },
    listSettingKeys: async (prefix) => [...settings.keys()].filter((key) => key.startsWith(prefix)),
    // 1 为管理员；2—99 为普通注册用户；其余不存在。
    presenterAccount: async (accountId) => {
      if (accountId === 1) return { isAdmin: true, displayName: "管理员", sermonPresenterUntil: null };
      if (grants.has(accountId)) return { isAdmin: false, displayName: `讲道者${accountId}`, sermonPresenterUntil: new Date("9999-12-31T23:59:59.999Z") };
      if (accountId >= 2 && accountId < 100) return { isAdmin: false, displayName: `用户${accountId}`, sermonPresenterUntil: null };
      return null;
    },
    accountExists: async (accountId) => accountId >= 1 && accountId < 100,
    createId: () => `id-${++counter}`,
    now: () => new Date(NOW)
  };
  const service = createSermonPresentationService(deps);
  return { service, settings, saves, deletions };
}

test("start 小组演示：创建记录、目录可见、按讲道者键持久化 scope", async () => {
  const { service, settings, saves } = createHarness();
  const { record, invited } = await service.start({ accountId: 7, displayName: "用户7" }, "group", [9, 9, 7]);
  assert.equal(record.scope, "group");
  assert.deepEqual(invited, [9], "去重并排除主持人自己");

  const directory = service.directory();
  assert.equal(directory.length, 1);
  assert.deepEqual(directory[0], {
    presenterId: 7,
    presenterName: "用户7",
    scope: "group",
    active: false,
    audienceCount: 0,
    invitedAccountIds: [9]
  });

  const key = sermonSettingKeyFor(7);
  assert.equal(settings.get(key), saves[saves.length - 1].value);
  assert.ok(saves.some((entry) => entry.key === key), "按 sermon.presentation.{accountId} 键持久化");
  const persisted = deserializeSermonState(settings.get(key) ?? null);
  assert.equal(persisted.scope, "group");
  assert.equal(persisted.presenterId, "7");
});

test("start 集会演示：无授权拒绝，有授权（管理员/有效期内）通过并复检", async () => {
  const { service } = createHarness();
  await assert.rejects(
    () => service.start({ accountId: 7, displayName: "用户7" }, "assembly"),
    (error: unknown) => error instanceof SermonPresentationError && error.message === "无集会讲道授权，仅可发起小组演示"
  );
  assert.equal(service.get(7), undefined, "被拒绝后不产生演示");

  const admin = await service.start({ accountId: 1, displayName: "管理员" }, "assembly");
  assert.equal(admin.record.scope, "assembly");
  assert.deepEqual(service.directory()[0].invitedAccountIds, [], "集会目录不暴露受邀名单");

  const { service: grantedService } = createHarness({ grantIds: [8] });
  const granted = await grantedService.start({ accountId: 8, displayName: "讲道者8" }, "assembly");
  assert.equal(granted.record.scope, "assembly");
});

test("start 幂等：已有演示（如重启恢复）时返回现有记录", async () => {
  const { service, saves } = createHarness();
  await service.start({ accountId: 7, displayName: "用户7" }, "group");
  const count = saves.length;
  const again = await service.start({ accountId: 7, displayName: "用户7" }, "assembly");
  assert.equal(again.record.scope, "group", "已存在时不改范围");
  assert.equal(saves.length, count, "幂等返回不重复写库");
});

test("join 准入：小组需受邀、集会全员可加入、主持人不占席", async () => {
  const { service } = createHarness();
  await service.start({ accountId: 7, displayName: "用户7" }, "group", [9]);
  await assert.rejects(
    () => Promise.resolve(service.join(8, 7)),
    (error: unknown) => error instanceof SermonPresentationError && error.message === "该演示仅受邀账号可加入"
  );

  service.join(9, 7);
  assert.equal(service.seatOf(9), 7);
  assert.equal(service.directory()[0].audienceCount, 1);

  // 主持人加入自己的演示：是成员但不占观众席
  service.join(7, 7);
  assert.equal(service.seatOf(7), null);
  assert.equal(service.directory()[0].audienceCount, 1, "主持人不占席");

  const { service: assemblyService } = createHarness();
  await assemblyService.start({ accountId: 1, displayName: "管理员" }, "assembly");
  assemblyService.join(55, 1);
  assert.equal(assemblyService.seatOf(55), 1, "集会演示任何账号可加入");

  await assert.rejects(
    () => Promise.resolve(service.join(9, 404)),
    (error: unknown) => error instanceof SermonPresentationError && error.message === "演示不存在或已结束"
  );
});

test("席位单席互斥：已入座他席拒绝（seated-elsewhere），离开后换席成功", async () => {
  const { service } = createHarness();
  await service.start({ accountId: 7, displayName: "用户7" }, "group", [9]);
  await service.start({ accountId: 8, displayName: "用户8" }, "group", [9]);
  service.join(9, 7);

  await assert.rejects(
    () => Promise.resolve(service.join(9, 8)),
    (error: unknown) =>
      error instanceof SermonSeatConflictError && error.code === "seated-elsewhere" && error.message === "你已在观看其他演示，请先离开再加入"
  );
  assert.equal(service.seatOf(9), 7, "拒绝后仍在原席");

  assert.equal(service.leave(9), 7, "leave 返回释放的演示");
  service.join(9, 8);
  assert.equal(service.seatOf(9), 8, "一键换席：leave + join 成功");
  assert.equal(service.get(7)?.audience.size, 0);
  assert.equal(service.get(8)?.audience.size, 1);

  assert.equal(service.leave(66), null, "无席 leave 返回 null");
  assert.equal(service.releaseSeats(9), 8, "releaseSeats 与 leave 同语义");
  assert.equal(service.seatOf(9), null);
});

test("invite 校验：账号需存在且未入座他席；新增写入受邀集合", async () => {
  const { service } = createHarness();
  await assert.rejects(
    () => service.invite(7, [9]),
    (error: unknown) => error instanceof SermonPresentationError && error.message === "请先开始演示"
  );

  await service.start({ accountId: 7, displayName: "用户7" }, "group");
  await assert.rejects(
    () => service.invite(7, [999]),
    (error: unknown) => error instanceof SermonPresentationError && error.message === "所选账号不存在"
  );

  await service.start({ accountId: 8, displayName: "用户8" }, "group", [9]);
  service.join(9, 8);
  await assert.rejects(
    () => service.invite(7, [9]),
    (error: unknown) => error instanceof SermonPresentationError && error.message === "所选账号已在观看其他演示"
  );

  const added = await service.invite(7, [10, 11, 11, 7]);
  assert.deepEqual(added, [10, 11], "去重并排除主持人自己");
  assert.deepEqual(service.directory().find((entry) => entry.presenterId === 7)?.invitedAccountIds, [10, 11]);

  const reAdded = await service.invite(7, [10]);
  assert.deepEqual(reAdded, [], "已在受邀集合中不算新增");
});

test("removeViewer：主持人移除观众并释放其席位", async () => {
  const { service } = createHarness();
  await service.start({ accountId: 7, displayName: "用户7" }, "group", [9]);
  service.join(9, 7);

  assert.equal(service.removeViewer(7, 66), false, "不在观众席返回 false");
  assert.equal(service.removeViewer(8, 9), false, "非主持人返回 false");
  assert.equal(service.removeViewer(7, 9), true);
  assert.equal(service.seatOf(9), null);
  assert.equal(service.get(7)?.audience.size, 0);
});

test("end：全员释席、清空受邀、持久化清空状态、目录移除", async () => {
  const { service, settings } = createHarness();
  await service.start({ accountId: 7, displayName: "用户7" }, "group", [9, 10]);
  service.join(9, 7);
  await service.get(7)?.store.add({ id: "7", name: "用户7" }, [
    { blocks: [{ type: "text", content: "大纲" }], verses: [], source: "大纲" }
  ]);

  const ended = await service.end(7, false);
  assert.deepEqual(ended.audience, [9]);
  assert.deepEqual(ended.invited.sort((a, b) => a - b), [9, 10]);
  assert.equal(ended.state.active, false);
  assert.equal(ended.state.queue.length, 0, "结束时清空队列");
  assert.equal(service.get(7), undefined);
  assert.equal(service.seatOf(9), null);
  assert.deepEqual(service.directory(), []);

  const persisted = deserializeSermonState(settings.get(sermonSettingKeyFor(7)) ?? null);
  assert.equal(persisted.queue.length, 0, "持久化行保留为清空状态");
  assert.equal(persisted.active, false);
});

test("end 权限：仅管理员可强制结束他人演示", async () => {
  const { service } = createHarness();
  await service.start({ accountId: 7, displayName: "用户7" }, "group");
  await assert.rejects(
    () => service.end(8, false, 7),
    (error: unknown) => error instanceof SermonPresentationError && error.message === "需要管理员权限才能结束他人的演示"
  );
  assert.ok(service.get(7), "非管理员强制结束被拒绝");

  await service.end(1, true, 7);
  assert.equal(service.get(7), undefined, "管理员可强制结束");
  await assert.rejects(
    () => service.end(1, true, 7),
    (error: unknown) => error instanceof SermonPresentationError && error.message === "演示不存在或已结束"
  );
});

test("releaseSeats：只释放观众席，主持人断线演示继续", async () => {
  const { service } = createHarness();
  await service.start({ accountId: 7, displayName: "用户7" }, "group", [9]);
  service.join(9, 7);

  assert.equal(service.releaseSeats(7), null, "主持人没有观众席");
  assert.ok(service.get(7), "主持人断线不结束演示");
  assert.equal(service.releaseSeats(9), 7, "观众断线释放席位");
  assert.equal(service.get(7)?.audience.size, 0);
});

test("directory：多演示并存，按讲道者排序，集会不暴露受邀名单", async () => {
  const { service } = createHarness();
  await service.start({ accountId: 8, displayName: "用户8" }, "group", [9]);
  await service.start({ accountId: 1, displayName: "管理员" }, "assembly");
  service.join(9, 8);

  const directory = service.directory();
  assert.deepEqual(directory.map((entry) => entry.presenterId), [1, 8], "按讲道者账号排序");
  assert.equal(directory[0].scope, "assembly");
  assert.deepEqual(directory[0].invitedAccountIds, []);
  assert.equal(directory[1].audienceCount, 1);
  assert.deepEqual(directory[1].invitedAccountIds, [9]);
});

test("migrateLegacy：旧全局行迁移到 per-presenter 键后删除；目标键已存在则保留", async () => {
  const { service, settings, deletions } = createHarness();
  await service.migrateLegacy();
  assert.deepEqual(deletions, [], "无旧行时不动");

  const legacy = persistedState(undefined, "7");
  const harness2 = createHarness();
  harness2.settings.set(SERMON_LEGACY_SETTING_KEY, legacy);
  await harness2.service.migrateLegacy();
  assert.equal(harness2.settings.get(sermonSettingKeyFor(7)), legacy, "旧行写入 presenterId 对应键");
  assert.equal(harness2.settings.has(SERMON_LEGACY_SETTING_KEY), false, "旧行删除");
  assert.ok(harness2.deletions.includes(SERMON_LEGACY_SETTING_KEY));

  // presenterId 已存在的目标键：跳过写入（以新键为准），仍删除旧行
  const harness3 = createHarness();
  harness3.settings.set(SERMON_LEGACY_SETTING_KEY, legacy);
  const newer = persistedState("group", "7");
  harness3.settings.set(sermonSettingKeyFor(7), newer);
  await harness3.service.migrateLegacy();
  assert.equal(harness3.settings.get(sermonSettingKeyFor(7)), newer, "已存在的新键不被覆盖");
  assert.equal(harness3.settings.has(SERMON_LEGACY_SETTING_KEY), false);

  // presenterId 不可解析：无法迁移，仍清理旧行
  const harness4 = createHarness();
  harness4.settings.set(SERMON_LEGACY_SETTING_KEY, persistedState(undefined, "abc"));
  await harness4.service.migrateLegacy();
  assert.equal(harness4.settings.has(sermonSettingKeyFor(7)), false);
  assert.equal(harness4.settings.has(SERMON_LEGACY_SETTING_KEY), false);
});

test("restoreAll：前缀扫描恢复演示（scope 缺省迁移为集会），空状态行清理，观众从空开始", async () => {
  const { service, settings } = createHarness();
  settings.set(sermonSettingKeyFor(7), persistedState(undefined, "7"));
  settings.set(sermonSettingKeyFor(8), persistedState("group", "8"));
  settings.set(sermonSettingKeyFor(9), serializeSermonState(emptySermonState()));
  settings.set(`${sermonSettingKeyFor(9)}x`, persistedState("group", "9"));
  settings.set("sermon.presentation", persistedState(undefined, "3"));

  await service.restoreAll();
  const directory = service.directory();
  assert.deepEqual(directory.map((entry) => entry.presenterId), [7, 8]);
  assert.equal(directory[0].scope, "assembly", "旧数据无 scope 按集会恢复");
  assert.equal(service.get(7)?.store.getState().queue.length, 1, "恢复不丢队列");
  assert.equal(directory[1].scope, "group");
  assert.equal(directory[0].audienceCount, 0, "观众关系易失，重启从空开始");
  assert.equal(settings.has(sermonSettingKeyFor(9)), false, "空状态行被清理");
  assert.ok(settings.has("sermon.presentation"), "恢复不动旧全局行（由 migrateLegacy 处理）");
});

test("start 时恢复已有持久化队列：讲道者重开演示不丢内容", async () => {
  const { service, settings } = createHarness();
  settings.set(sermonSettingKeyFor(7), persistedState("group", "7"));
  const { record } = await service.start({ accountId: 7, displayName: "用户7" }, "group");
  assert.equal(record.store.getState().queue.length, 1, "start 先 load 已有状态");
  assert.equal(record.store.getState().scope, "group");
});
