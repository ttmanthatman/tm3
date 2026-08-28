import type { SermonPresentationScope, SermonPresentationSummaryDTO, SermonStateDTO } from "../../shared/types.js";
import { canPresentSermon, type SermonPresenterAccount } from "./permissions.js";
import { createSermonStateStore, deserializeSermonState, type SermonStateStore } from "./state.js";

/** 一期全局演示的持久化键；启动时迁移到 per-presenter 键后删除。 */
export const SERMON_LEGACY_SETTING_KEY = "sermon.presentation";
export const SERMON_SETTING_KEY_PREFIX = "sermon.presentation.";

export function sermonSettingKeyFor(accountId: number): string {
  return `${SERMON_SETTING_KEY_PREFIX}${accountId}`;
}

/** 业务规则错误：message 为 public-safe 中文，可直接回给客户端。 */
export class SermonPresentationError extends Error {}

/** 观众已入座其他演示：客户端据此提供「离开并加入」一键操作。 */
export class SermonSeatConflictError extends SermonPresentationError {
  readonly code = "seated-elsewhere" as const;
}

export type PresentationRecord = {
  presenterAccountId: number;
  presenterName: string;
  scope: SermonPresentationScope;
  store: SermonStateStore;
  audience: Set<number>;
  invited: Set<number>;
};

export type SermonPresentationServiceDeps = {
  loadSetting(key: string): Promise<string | null>;
  saveSetting(key: string, value: string): Promise<void>;
  deleteSetting(key: string): Promise<void>;
  listSettingKeys(prefix: string): Promise<string[]>;
  presenterAccount(accountId: number): Promise<(SermonPresenterAccount & { displayName: string }) | null>;
  accountExists(accountId: number): Promise<boolean>;
  createId?: () => string;
  now?: () => Date;
};

export type SermonPresentationStart = {
  accountId: number;
  displayName: string;
};

export type SermonEndedPresentation = {
  presenterAccountId: number;
  presenterName: string;
  scope: SermonPresentationScope;
  /** 结束时在席的观众（用于定向通知与强制离房）。 */
  audience: number[];
  /** 结束时仍在受邀集合中的账号（用于定向通知）。 */
  invited: number[];
  /** 清空后的最终状态（active:false），供房间内广播。 */
  state: SermonStateDTO;
};

/**
 * 讲道演示服务（二期）：按讲道者并存多个演示。
 * 席位映射保证账号级单席互斥（多 socket 共享一个账号席）；
 * 观众关系易失，断线由调用方 releaseSeats 释放；主持人断线不结束演示。
 */
export function createSermonPresentationService(deps: SermonPresentationServiceDeps) {
  const presentations = new Map<number, PresentationRecord>();
  const seats = new Map<number, number>();

  function createStore(accountId: number): SermonStateStore {
    const key = sermonSettingKeyFor(accountId);
    return createSermonStateStore({
      persistence: {
        load: () => deps.loadSetting(key),
        save: (value) => deps.saveSetting(key, value)
      },
      createId: deps.createId,
      now: deps.now
    });
  }

  // 邀请名单校验：去重、排除主持人自己、账号存在且未入座他席。
  async function assertInvitable(presenterAccountId: number, accountIds: number[]): Promise<number[]> {
    const unique = [...new Set(accountIds)].filter((id) => id !== presenterAccountId);
    for (const accountId of unique) {
      if (!(await deps.accountExists(accountId))) throw new SermonPresentationError("所选账号不存在");
      const seated = seats.get(accountId);
      if (seated !== undefined && seated !== presenterAccountId) {
        throw new SermonPresentationError("所选账号已在观看其他演示");
      }
    }
    return unique;
  }

  function releaseSeat(accountId: number): number | null {
    const seated = seats.get(accountId);
    if (seated === undefined) return null;
    presentations.get(seated)?.audience.delete(accountId);
    seats.delete(accountId);
    return seated;
  }

  const service = {
    /** 发起演示：已存在（如重启恢复）时幂等返回；集会模式用新鲜账号读取复检授权。 */
    async start(actor: SermonPresentationStart, scope: SermonPresentationScope, invitedAccountIds: number[] = []) {
      const existing = presentations.get(actor.accountId);
      if (existing) return { record: existing, invited: [] as number[] };
      if (scope === "assembly") {
        const account = await deps.presenterAccount(actor.accountId);
        if (!account || !canPresentSermon(account)) {
          throw new SermonPresentationError("无集会讲道授权，仅可发起小组演示");
        }
      }
      const invited = await assertInvitable(actor.accountId, invitedAccountIds);
      const store = createStore(actor.accountId);
      await store.load();
      await store.setScope({ id: String(actor.accountId), name: actor.displayName }, scope);
      const record: PresentationRecord = {
        presenterAccountId: actor.accountId,
        presenterName: actor.displayName,
        scope,
        store,
        audience: new Set(),
        invited: new Set(invited)
      };
      presentations.set(actor.accountId, record);
      return { record, invited };
    },

    /** 观众入座：校验演示存在、小组需受邀、集会全员可加入、单席互斥。
     * 主持人加入自己的演示是成员但不占观众席。 */
    async join(viewerAccountId: number, presenterAccountId: number): Promise<PresentationRecord> {
      const record = presentations.get(presenterAccountId);
      if (!record) throw new SermonPresentationError("演示不存在或已结束");
      if (viewerAccountId === presenterAccountId) return record;
      const seated = seats.get(viewerAccountId);
      if (seated !== undefined) {
        if (seated === presenterAccountId) return record;
        throw new SermonSeatConflictError("你已在观看其他演示，请先离开再加入");
      }
      if (record.scope === "group" && !record.invited.has(viewerAccountId)) {
        throw new SermonPresentationError("该演示仅受邀账号可加入");
      }
      record.audience.add(viewerAccountId);
      seats.set(viewerAccountId, presenterAccountId);
      return record;
    },

    /** 自我释放席位：返回释放的演示讲道者账号（无席返回 null）。 */
    leave(viewerAccountId: number): number | null {
      return releaseSeat(viewerAccountId);
    },

    /** 断线/登出释放（与 leave 同语义；主持人自己的演示不受影响）。 */
    releaseSeats(accountId: number): number | null {
      return releaseSeat(accountId);
    },

    /** 仅主持人：校验后写入受邀集合，返回实际新增（去重、排除自己、跳过已在集合）的账号。 */
    async invite(presenterAccountId: number, accountIds: number[]): Promise<number[]> {
      const record = presentations.get(presenterAccountId);
      if (!record) throw new SermonPresentationError("请先开始演示");
      const added = (await assertInvitable(presenterAccountId, accountIds)).filter((accountId) => !record.invited.has(accountId));
      for (const accountId of added) record.invited.add(accountId);
      return added;
    },

    /** 仅主持人：把观众移出演示并释放其席位。 */
    removeViewer(presenterAccountId: number, accountId: number): boolean {
      const record = presentations.get(presenterAccountId);
      if (!record || !record.audience.has(accountId)) return false;
      record.audience.delete(accountId);
      if (seats.get(accountId) === presenterAccountId) seats.delete(accountId);
      return true;
    },

    /**
     * 结束演示：无参结束自己的；管理员可带 presenterAccountId 强制结束他人。
     * 全员释席、清空受邀集合；持久化行保留为清空状态（重启恢复时空行被清理）。
     */
    async end(actorAccountId: number, actorIsAdmin: boolean, presenterAccountId?: number): Promise<SermonEndedPresentation> {
      const target = presenterAccountId ?? actorAccountId;
      if (target !== actorAccountId && !actorIsAdmin) {
        throw new SermonPresentationError("需要管理员权限才能结束他人的演示");
      }
      const record = presentations.get(target);
      if (!record) throw new SermonPresentationError("演示不存在或已结束");
      const audience = [...record.audience];
      const invited = [...record.invited];
      const state = await record.store.clear({ id: String(target), name: record.presenterName });
      for (const accountId of audience) seats.delete(accountId);
      presentations.delete(target);
      record.audience.clear();
      record.invited.clear();
      return {
        presenterAccountId: target,
        presenterName: record.presenterName,
        scope: record.scope,
        audience,
        invited,
        state
      };
    },

    /** 账号当前入座的演示讲道者账号；未入座返回 null。 */
    seatOf(accountId: number): number | null {
      return seats.get(accountId) ?? null;
    },

    get(presenterAccountId: number): PresentationRecord | undefined {
      return presentations.get(presenterAccountId);
    },

    /** 演示目录：集会演示不暴露受邀名单。 */
    directory(): SermonPresentationSummaryDTO[] {
      return [...presentations.values()]
        .sort((a, b) => a.presenterAccountId - b.presenterAccountId)
        .map((record) => ({
          presenterId: record.presenterAccountId,
          presenterName: record.presenterName,
          scope: record.scope,
          active: record.store.getState().active,
          audienceCount: record.audience.size,
          invitedAccountIds: record.scope === "group" ? [...record.invited].sort((a, b) => a - b) : []
        }));
    },

    /** 旧全局行迁移：按 presenterId 写入 per-presenter 键（已存在则跳过），随后删除旧行。 */
    async migrateLegacy(): Promise<void> {
      const raw = await deps.loadSetting(SERMON_LEGACY_SETTING_KEY);
      if (raw === null) return;
      const presenterId = Number(deserializeSermonState(raw).presenterId);
      if (Number.isInteger(presenterId) && presenterId > 0) {
        const targetKey = sermonSettingKeyFor(presenterId);
        if ((await deps.loadSetting(targetKey)) === null) await deps.saveSetting(targetKey, raw);
      }
      await deps.deleteSetting(SERMON_LEGACY_SETTING_KEY);
    },

    /** 启动恢复：前缀扫描重建演示（观众关系易失，从空开始）；空状态行清理删除。 */
    async restoreAll(): Promise<void> {
      const keys = await deps.listSettingKeys(SERMON_SETTING_KEY_PREFIX);
      for (const key of keys) {
        const accountId = Number(key.slice(SERMON_SETTING_KEY_PREFIX.length));
        if (!Number.isInteger(accountId) || accountId <= 0) continue;
        const store = createStore(accountId);
        const state = await store.load();
        if (!state.queue.length && !state.active) {
          await deps.deleteSetting(key);
          continue;
        }
        presentations.set(accountId, {
          presenterAccountId: accountId,
          presenterName: state.presenterName || "讲道者",
          scope: state.scope,
          store,
          audience: new Set(),
          invited: new Set()
        });
      }
    }
  };

  return service;
}

export type SermonPresentationService = ReturnType<typeof createSermonPresentationService>;
