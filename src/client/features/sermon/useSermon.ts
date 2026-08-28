import { ref, shallowRef, type ShallowRef } from "vue";
import type {
  SermonAnnotation,
  SermonAnnotationKind,
  SermonDisplayDTO,
  SermonEndedEvent,
  SermonInvitedEvent,
  SermonPresentationScope,
  SermonPresentationSummaryDTO,
  SermonPresenterStatusDTO,
  SermonRemovedEvent,
  SermonSlideInput,
  SermonStateDTO,
  SermonWatchAccountDTO
} from "@shared/types";
import { api } from "../../api";

export type SermonRequestDecisionEvent = {
  messageId: number;
  approve: boolean;
  until: string | null;
};

export type SermonAddError = { reference: string; message: string };

export type SermonAck = {
  ok?: boolean;
  message?: string;
  /** 服务端拒绝码（如 seated-elsewhere），供 UI 做「离开并加入」等分支处理 */
  code?: string;
  added?: number;
  errors?: SermonAddError[];
};

export interface SermonSocket {
  connected: boolean;
  timeout(timeoutMs: number): SermonSocket;
  emit(event: string, payload: unknown, ack: (error: Error | null, response?: SermonAck) => void): unknown;
}

export type SermonEmitResult =
  | { ok: true; added?: number; errors?: SermonAddError[] }
  | { ok: false; reason: "disconnected" | "timeout" | "rejected" | "transport"; message: string; code?: string };

/** 被移出/演示结束轻提示（SermonHub 渲染为底部 toast，数秒自动消失）。 */
export type SermonNotice = { kind: "removed" | "ended"; presenterName: string };

export type SermonSharedState = {
  /** 最近一次服务端全量推送；仅当推送方是本人主持的演示或本人入座的演示时应用。 */
  sermonState: ShallowRef<SermonStateDTO | null>;
  presenterStatus: ShallowRef<SermonPresenterStatusDTO | null>;
  latestRequestDecision: ShallowRef<SermonRequestDecisionEvent | null>;
  /** 全部进行中/未清空的演示目录（sermon:directory 推送 + HTTP 兜底）。 */
  directory: ShallowRef<SermonPresentationSummaryDTO[]>;
  /** 当前有效的观看邀请（演示存活期间有效；目录刷新时自动 prune）。 */
  invites: ShallowRef<SermonInvitedEvent[]>;
  /** 本人当前入座的演示（主持人 = 自己的账号 ID）；null 表示未入座/未主持。 */
  joinedPresentationId: ShallowRef<number | null>;
  /** 被移出或演示结束的轻提示。 */
  notice: ShallowRef<SermonNotice | null>;
  /** 主持人观众选择器数据（/api/sermon/accounts）。 */
  watchAccounts: ShallowRef<SermonWatchAccountDTO[]>;
};

export function createSermonState(): SermonSharedState {
  return {
    sermonState: shallowRef<SermonStateDTO | null>(null),
    presenterStatus: shallowRef<SermonPresenterStatusDTO | null>(null),
    latestRequestDecision: shallowRef<SermonRequestDecisionEvent | null>(null),
    directory: shallowRef<SermonPresentationSummaryDTO[]>([]),
    invites: shallowRef<SermonInvitedEvent[]>([]),
    joinedPresentationId: shallowRef<number | null>(null),
    notice: shallowRef<SermonNotice | null>(null),
    watchAccounts: shallowRef<SermonWatchAccountDTO[]>([])
  };
}

const sharedSermonState = createSermonState();

/** 本人账号 ID（connectSocket 时设置）：用于判断推送是否为本人主持的演示。 */
let ownAccountId: number | null = null;

export function setSermonOwnAccountId(accountId: number | null) {
  ownAccountId = accountId;
}

export function getSermonOwnAccountId() {
  return ownAccountId;
}

/**
 * store 的 connectSocket() 订阅入口：服务端全量推送（只发房间内成员）。
 * 仅当推送方与本人入座的演示一致、或本人就是该演示的主持人时应用，其余演示的推送忽略。
 */
export function applySermonState(state: SermonStateDTO) {
  if (!state || typeof state.active !== "boolean") {
    sharedSermonState.sermonState.value = null;
    return;
  }
  const presenterId = Number(state.presenterId);
  const isOwnPresentation = ownAccountId !== null && presenterId === ownAccountId;
  if (!isOwnPresentation && presenterId !== sharedSermonState.joinedPresentationId.value) return;
  sharedSermonState.sermonState.value = state;
}

export function applySermonRequestDecision(event: SermonRequestDecisionEvent) {
  if (!event || !Number.isInteger(event.messageId)) return;
  sharedSermonState.latestRequestDecision.value = {
    messageId: event.messageId,
    approve: !!event.approve,
    until: typeof event.until === "string" ? event.until : null
  };
}

/** store 订阅 sermon:directory：全量替换目录，并 prune 已不在目录中的邀请（演示已结束/清空）。 */
export function applySermonDirectory(list: SermonPresentationSummaryDTO[] | null | undefined) {
  sharedSermonState.directory.value = Array.isArray(list) ? list : [];
  const aliveIds = new Set(sharedSermonState.directory.value.map((entry) => entry.presenterId));
  if (sharedSermonState.invites.value.some((invite) => !aliveIds.has(invite.presenterId))) {
    sharedSermonState.invites.value = sharedSermonState.invites.value.filter((invite) => aliveIds.has(invite.presenterId));
  }
}

/** store 订阅 sermon:invited（定向）：邀请在演示存活期间有效。 */
export function applySermonInvited(event: SermonInvitedEvent) {
  if (!event || !Number.isInteger(event.presenterId)) return;
  const next = sharedSermonState.invites.value.filter((invite) => invite.presenterId !== event.presenterId);
  next.push({
    presenterId: event.presenterId,
    presenterName: typeof event.presenterName === "string" ? event.presenterName : "",
    scope: event.scope === "assembly" ? "assembly" : "group"
  });
  sharedSermonState.invites.value = next;
}

/** store 订阅 sermon:removed（定向，被主持人移出）：释放席位并给出轻提示。 */
export function applySermonRemoved(event: SermonRemovedEvent) {
  if (!event || !Number.isInteger(event.presenterId)) return;
  releaseSeat(event.presenterId);
  sharedSermonState.notice.value = { kind: "removed", presenterName: typeof event.presenterName === "string" ? event.presenterName : "" };
}

/** store 订阅 sermon:ended（定向，演示结束）：释放席位并给出轻提示。 */
export function applySermonEnded(event: SermonEndedEvent) {
  if (!event || !Number.isInteger(event.presenterId)) return;
  releaseSeat(event.presenterId);
  sharedSermonState.notice.value = { kind: "ended", presenterName: typeof event.presenterName === "string" ? event.presenterName : "" };
}

function releaseSeat(presenterId: number) {
  if (sharedSermonState.joinedPresentationId.value === presenterId) {
    sharedSermonState.joinedPresentationId.value = null;
    sharedSermonState.sermonState.value = null;
  }
  sharedSermonState.invites.value = sharedSermonState.invites.value.filter((invite) => invite.presenterId !== presenterId);
}

export function clearSermonNotice() {
  sharedSermonState.notice.value = null;
}


/**
 * 断线/刷新时服务端会释放观众席：客户端同步释放非本人主持的入座，
 * 使覆盖层立即卸载（重连后需重新加入）。
 */
export function releaseSermonAudienceSeat() {
  const joined = sharedSermonState.joinedPresentationId.value;
  if (joined === null || joined === ownAccountId) return;
  sharedSermonState.joinedPresentationId.value = null;
  sharedSermonState.sermonState.value = null;
}

/** 登出/换号时清掉会话内的 sermon 数据。 */
export function resetSermonState() {
  sharedSermonState.sermonState.value = null;
  sharedSermonState.presenterStatus.value = null;
  sharedSermonState.latestRequestDecision.value = null;
  sharedSermonState.directory.value = [];
  sharedSermonState.invites.value = [];
  sharedSermonState.joinedPresentationId.value = null;
  sharedSermonState.notice.value = null;
  sharedSermonState.watchAccounts.value = [];
}

// —— 按账号命名空间的邀请静音集合（localStorage，仿 team-chat-last-noticed-version 模式） ——

const SERMON_MUTED_PREFIX = "team-chat-sermon-muted:";
let mutedCache: { accountId: number; ids: Set<number> } | null = null;

function readMutedIds(accountId: number): Set<number> {
  if (mutedCache && mutedCache.accountId === accountId) return mutedCache.ids;
  const ids = new Set<number>();
  if (typeof localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(`${SERMON_MUTED_PREFIX}${accountId}`);
      if (raw) {
        for (const value of JSON.parse(raw) as unknown[]) {
          if (typeof value === "number" && Number.isInteger(value)) ids.add(value);
        }
      }
    } catch {
      // 静音集合读取失败不影响功能，按未静音处理。
    }
  }
  mutedCache = { accountId, ids };
  return ids;
}

function persistMutedIds(accountId: number, ids: Set<number>) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(`${SERMON_MUTED_PREFIX}${accountId}`, JSON.stringify([...ids]));
  } catch {
    // 持久化失败仅影响刷新后的静音恢复。
  }
}

export function loadSermonMutedIds(accountId: number): Set<number> {
  return readMutedIds(accountId);
}

export function isSermonPresenterMuted(accountId: number, presenterId: number) {
  return readMutedIds(accountId).has(presenterId);
}

/** 静音某讲道者的演示：静音期间该演示的邀请不再弹横幅。 */
export function muteSermonPresenter(accountId: number, presenterId: number) {
  const ids = readMutedIds(accountId);
  if (ids.has(presenterId)) return;
  ids.add(presenterId);
  persistMutedIds(accountId, ids);
}

/** 演示目录 HTTP 兜底（bootstrap 与 socket 断档重连后）；失败时保留现有目录。 */
export async function refreshSermonDirectory(request: <T>(path: string, init?: RequestInit) => Promise<T> = api) {
  const list = await request<SermonPresentationSummaryDTO[]>("/api/sermon/directory");
  applySermonDirectory(list);
  return sharedSermonState.directory.value;
}

export function useSermon(options: {
  getSocket: () => SermonSocket | null;
  request?: <T>(path: string, init?: RequestInit) => Promise<T>;
  timeoutMs?: number;
  state?: SermonSharedState;
}) {
  const state = options.state ?? sharedSermonState;
  const request = options.request ?? api;
  const pending = ref(false);
  const statusMessage = ref("");

  async function emit(event: string, payload?: unknown): Promise<SermonEmitResult> {
    const socket = options.getSocket();
    if (!socket?.connected) {
      const result = { ok: false, reason: "disconnected", message: "连接恢复后再操作" } as const;
      statusMessage.value = result.message;
      return result;
    }
    pending.value = true;
    statusMessage.value = "正在同步…";
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: SermonEmitResult) => {
        if (settled) return;
        settled = true;
        pending.value = false;
        statusMessage.value = result.ok ? "" : result.message;
        resolve(result);
      };
      try {
        socket.timeout(options.timeoutMs ?? 10_000).emit(event, payload ?? {}, (error, ack) => {
          if (error) {
            finish({ ok: false, reason: "timeout", message: "操作结果未确认，请稍后核对讲道队列状态" });
            return;
          }
          if (!ack?.ok) {
            finish({
              ok: false,
              reason: "rejected",
              message: ack?.message || "操作被拒绝，可能没有讲道权限",
              code: ack?.code
            });
            return;
          }
          finish({ ok: true, added: ack.added, errors: ack.errors });
        });
      } catch {
        finish({ ok: false, reason: "transport", message: "操作发送失败，请重试" });
      }
    });
  }

  const add = (slides: SermonSlideInput[]) => emit("sermon:add", { slides });
  const update = (id: string, slide: SermonSlideInput) => emit("sermon:update", { id, slide });
  const scroll = (id: string, lines: number) => emit("sermon:scroll", { id, lines });
  const reorder = (order: string[]) => emit("sermon:reorder", { order });
  const remove = (id: string) => emit("sermon:remove", { id });
  const present = (id: string | null) => emit("sermon:present", { id });
  const setDisplay = (patch: Partial<SermonDisplayDTO>) => emit("sermon:display", patch);
  const annotate = (itemId: string, annotation: SermonAnnotation) => emit("sermon:annotate", { itemId, annotation });
  const clearAnnotations = (itemId: string, verseIndex?: number, kind?: SermonAnnotationKind) =>
    emit("sermon:annotate:clear", { itemId, ...(verseIndex === undefined ? {} : { verseIndex }), ...(kind ? { kind } : {}) });
  const clearPresentation = () => emit("sermon:clear", {});

  // —— 二期：多并发演示与观众互斥 ——

  /**
   * 开始演示：乐观设置入座（服务端的快照推送可能先于 ack 到达），失败回滚。
   */
  async function start(scope: SermonPresentationScope, invitedAccountIds: number[] = []) {
    const previous = state.joinedPresentationId.value;
    if (ownAccountId !== null) state.joinedPresentationId.value = ownAccountId;
    const result = await emit("sermon:start", { scope, invitedAccountIds });
    if (!result.ok) state.joinedPresentationId.value = previous;
    return result;
  }

  /** 入座观看：乐观设置入座，失败（如 seated-elsewhere）回滚并透出 code。 */
  async function join(presenterId: number) {
    const previous = state.joinedPresentationId.value;
    state.joinedPresentationId.value = presenterId;
    state.sermonState.value = null;
    const result = await emit("sermon:join", { presenterId });
    if (!result.ok) {
      state.joinedPresentationId.value = previous;
    } else {
      state.invites.value = state.invites.value.filter((invite) => invite.presenterId !== presenterId);
    }
    return result;
  }

  /** 离席：释放入座；覆盖层随 joinedPresentationId 清空而卸载。 */
  async function leave() {
    const previous = state.joinedPresentationId.value;
    state.joinedPresentationId.value = null;
    const result = await emit("sermon:leave", {});
    if (!result.ok) {
      state.joinedPresentationId.value = previous;
    } else {
      state.sermonState.value = null;
    }
    return result;
  }

  const invite = (accountIds: number[]) => emit("sermon:invite", { accountIds });
  const removeViewer = (accountId: number) => emit("sermon:remove-viewer", { accountId });
  const end = (presenterId?: number) =>
    emit("sermon:end", presenterId === undefined ? {} : { presenterId });

  async function refreshPresenterStatus() {
    state.presenterStatus.value = await request<SermonPresenterStatusDTO>("/api/sermon/presenter-status");
    return state.presenterStatus.value;
  }

  /** 主持人观众选择器数据；无讲道权限时服务端返回 403，由调用方降级处理。 */
  async function refreshWatchAccounts() {
    state.watchAccounts.value = await request<SermonWatchAccountDTO[]>("/api/sermon/accounts");
    return state.watchAccounts.value;
  }

  return {
    sermonState: state.sermonState,
    presenterStatus: state.presenterStatus,
    latestRequestDecision: state.latestRequestDecision,
    directory: state.directory,
    invites: state.invites,
    joinedPresentationId: state.joinedPresentationId,
    notice: state.notice,
    watchAccounts: state.watchAccounts,
    pending,
    statusMessage,
    add,
    update,
    scroll,
    reorder,
    remove,
    present,
    setDisplay,
    annotate,
    clearAnnotations,
    clearPresentation,
    start,
    join,
    leave,
    invite,
    removeViewer,
    end,
    refreshPresenterStatus,
    refreshWatchAccounts
  };
}
