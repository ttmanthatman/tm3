import { ref, shallowRef, type ShallowRef } from "vue";
import type {
  SermonAnnotation,
  SermonAnnotationKind,
  SermonDisplayDTO,
  SermonEndedEvent,
  SermonInvitedEvent,
  SermonPlanDTO,
  SermonPresentationPreviewDTO,
  SermonPresentationPreviewEvent,
  SermonPresentationScope,
  SermonPresentationSummaryDTO,
  SermonPresenterStatusDTO,
  SermonRemovedEvent,
  SermonSlideInput,
  SermonSlideLayoutDTO,
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
  plans?: SermonPlanDTO[];
};

export interface SermonSocket {
  connected: boolean;
  timeout(timeoutMs: number): SermonSocket;
  emit(event: string, payload: unknown, ack: (error: Error | null, response?: SermonAck) => void): unknown;
}

export type SermonEmitResult =
  | { ok: true; added?: number; errors?: SermonAddError[]; plans?: SermonPlanDTO[] }
  | { ok: false; reason: "disconnected" | "timeout" | "rejected" | "transport"; message: string; code?: string };

/** 被移出/演示结束轻提示（SermonHub 渲染为底部 toast，数秒自动消失）。 */
export type SermonNotice = { kind: "removed" | "ended"; presenterName: string };

export type SermonSharedState = {
  /** 本人主持的讲道台状态；与观看中的他人演示严格隔离。 */
  ownedState: ShallowRef<SermonStateDTO | null>;
  /** 本人当前获准观看的他人演示状态。 */
  watchedState: ShallowRef<SermonStateDTO | null>;
  presenterStatus: ShallowRef<SermonPresenterStatusDTO | null>;
  latestRequestDecision: ShallowRef<SermonRequestDecisionEvent | null>;
  /** 全部进行中/未清空的演示目录（sermon:directory 推送 + HTTP 兜底）。 */
  directory: ShallowRef<SermonPresentationSummaryDTO[]>;
  /** 当前有效的观看邀请（演示存活期间有效；目录刷新时自动 prune）。 */
  invites: ShallowRef<SermonInvitedEvent[]>;
  /** 本人当前作为观众入座的他人演示；主持自己的讲道台不占此席位。 */
  joinedPresentationId: ShallowRef<number | null>;
  /** 被移出或演示结束的轻提示。 */
  notice: ShallowRef<SermonNotice | null>;
  /** 主持人观众选择器数据（/api/sermon/accounts）。 */
  watchAccounts: ShallowRef<SermonWatchAccountDTO[]>;
  /** 本人保存的命名讲道队列方案。 */
  plans: ShallowRef<SermonPlanDTO[]>;
  /** 获准看到的进行中演示预览；小组画面仅由服务端定向推送。 */
  previews: ShallowRef<Record<number, SermonPresentationPreviewDTO>>;
};

export function createSermonState(): SermonSharedState {
  return {
    ownedState: shallowRef<SermonStateDTO | null>(null),
    watchedState: shallowRef<SermonStateDTO | null>(null),
    presenterStatus: shallowRef<SermonPresenterStatusDTO | null>(null),
    latestRequestDecision: shallowRef<SermonRequestDecisionEvent | null>(null),
    directory: shallowRef<SermonPresentationSummaryDTO[]>([]),
    invites: shallowRef<SermonInvitedEvent[]>([]),
    joinedPresentationId: shallowRef<number | null>(null),
    notice: shallowRef<SermonNotice | null>(null),
    watchAccounts: shallowRef<SermonWatchAccountDTO[]>([]),
    plans: shallowRef<SermonPlanDTO[]>([]),
    previews: shallowRef<Record<number, SermonPresentationPreviewDTO>>({})
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
    return;
  }
  const presenterId = Number(state.presenterId);
  const isOwnPresentation = ownAccountId !== null && presenterId === ownAccountId;
  if (isOwnPresentation) {
    sharedSermonState.ownedState.value = state;
    return;
  }
  if (presenterId === sharedSermonState.joinedPresentationId.value) {
    sharedSermonState.watchedState.value = state;
  }
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
  const previews = { ...sharedSermonState.previews.value };
  for (const key of Object.keys(previews)) {
    const presenterId = Number(key);
    const summary = sharedSermonState.directory.value.find((entry) => entry.presenterId === presenterId);
    if (!aliveIds.has(presenterId) || !summary?.active) delete previews[presenterId];
  }
  for (const entry of sharedSermonState.directory.value) {
    if (entry.active && entry.preview) previews[entry.presenterId] = entry.preview;
  }
  sharedSermonState.previews.value = previews;
  if (sharedSermonState.invites.value.some((invite) => !aliveIds.has(invite.presenterId))) {
    sharedSermonState.invites.value = sharedSermonState.invites.value.filter((invite) => aliveIds.has(invite.presenterId));
  }
}

export function applySermonPreview(event: SermonPresentationPreviewEvent) {
  if (!event || !Number.isInteger(event.presenterId)) return;
  const previews = { ...sharedSermonState.previews.value };
  if (event.preview) previews[event.presenterId] = event.preview;
  else delete previews[event.presenterId];
  sharedSermonState.previews.value = previews;
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
    sharedSermonState.watchedState.value = null;
  }
  sharedSermonState.invites.value = sharedSermonState.invites.value.filter((invite) => invite.presenterId !== presenterId);
  const previews = { ...sharedSermonState.previews.value };
  delete previews[presenterId];
  sharedSermonState.previews.value = previews;
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
  sharedSermonState.watchedState.value = null;
}

/** 登出/换号时清掉会话内的 sermon 数据。 */
export function resetSermonState() {
  sharedSermonState.ownedState.value = null;
  sharedSermonState.watchedState.value = null;
  sharedSermonState.presenterStatus.value = null;
  sharedSermonState.latestRequestDecision.value = null;
  sharedSermonState.directory.value = [];
  sharedSermonState.invites.value = [];
  sharedSermonState.joinedPresentationId.value = null;
  sharedSermonState.notice.value = null;
  sharedSermonState.watchAccounts.value = [];
  sharedSermonState.plans.value = [];
  sharedSermonState.previews.value = {};
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
          if (Array.isArray(ack.plans)) state.plans.value = ack.plans;
          finish({ ok: true, added: ack.added, errors: ack.errors, plans: ack.plans });
        });
      } catch {
        finish({ ok: false, reason: "transport", message: "操作发送失败，请重试" });
      }
    });
  }

  const add = (slides: SermonSlideInput[]) => emit("sermon:add", { slides });
  const update = (id: string, slide: SermonSlideInput) => emit("sermon:update", { id, slide });
  const scroll = (id: string, lines: number) => emit("sermon:scroll", { id, lines });
  const setLayout = (id: string, patch: Partial<SermonSlideLayoutDTO>) => emit("sermon:layout", { id, ...patch });
  const reorder = (order: string[]) => emit("sermon:reorder", { order });
  const remove = (id: string) => emit("sermon:remove", { id });
  const present = (id: string | null) => emit("sermon:present", { id });
  const setDisplay = (patch: Partial<SermonDisplayDTO>) => emit("sermon:display", patch);
  const annotate = (itemId: string, annotation: SermonAnnotation) => emit("sermon:annotate", { itemId, annotation });
  const clearAnnotations = (itemId: string, verseIndex?: number, kind?: SermonAnnotationKind) =>
    emit("sermon:annotate:clear", { itemId, ...(verseIndex === undefined ? {} : { verseIndex }), ...(kind ? { kind } : {}) });
  const clearPresentation = () => emit("sermon:clear", {});

  // —— 二期：多并发演示与观众互斥 ——

  /** 开始本人演示；主持状态与观众席分离，不再把本人误标为正在观看。 */
  async function start(scope: SermonPresentationScope, invitedAccountIds: number[] = []) {
    const result = await emit("sermon:start", { scope, invitedAccountIds });
    return result;
  }

  /** 入座观看：乐观设置入座，失败（如 seated-elsewhere）回滚并透出 code。 */
  async function join(presenterId: number) {
    const previous = state.joinedPresentationId.value;
    const previousState = state.watchedState.value;
    state.joinedPresentationId.value = presenterId;
    state.watchedState.value = null;
    const result = await emit("sermon:join", { presenterId });
    if (!result.ok) {
      state.joinedPresentationId.value = previous;
      state.watchedState.value = previousState;
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
      state.watchedState.value = null;
    }
    return result;
  }

  const invite = (accountIds: number[]) => emit("sermon:invite", { accountIds });
  const removeViewer = (accountId: number) => emit("sermon:remove-viewer", { accountId });
  const end = (presenterId?: number) =>
    emit("sermon:end", presenterId === undefined ? {} : { presenterId });
  const refreshPlans = () => emit("sermon:plans", {});
  const savePlan = (title: string, id?: string) => emit("sermon:plan-save", { title, ...(id ? { id } : {}) });
  const loadPlan = (id: string) => emit("sermon:plan-load", { id });
  const deletePlan = (id: string) => emit("sermon:plan-delete", { id });

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
    ownedState: state.ownedState,
    watchedState: state.watchedState,
    presenterStatus: state.presenterStatus,
    latestRequestDecision: state.latestRequestDecision,
    directory: state.directory,
    invites: state.invites,
    joinedPresentationId: state.joinedPresentationId,
    notice: state.notice,
    watchAccounts: state.watchAccounts,
    plans: state.plans,
    previews: state.previews,
    pending,
    statusMessage,
    add,
    update,
    scroll,
    setLayout,
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
    refreshPlans,
    savePlan,
    loadPlan,
    deletePlan,
    refreshPresenterStatus,
    refreshWatchAccounts
  };
}
