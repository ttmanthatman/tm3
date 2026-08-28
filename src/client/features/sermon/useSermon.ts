import { ref, shallowRef, type ShallowRef } from "vue";
import type { SermonAnnotation, SermonAnnotationKind, SermonPresenterStatusDTO, SermonStateDTO } from "@shared/types";
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
  | { ok: false; reason: "disconnected" | "timeout" | "rejected" | "transport"; message: string };

export type SermonSharedState = {
  /** 最近一次服务端全量推送；展示是否激活由 state.active 表达（观众端覆盖层仅在 active 时挂载，讲道台未激活时也要能看到队列）。 */
  sermonState: ShallowRef<SermonStateDTO | null>;
  presenterStatus: ShallowRef<SermonPresenterStatusDTO | null>;
  latestRequestDecision: ShallowRef<SermonRequestDecisionEvent | null>;
};

export function createSermonState(): SermonSharedState {
  return {
    sermonState: shallowRef<SermonStateDTO | null>(null),
    presenterStatus: shallowRef<SermonPresenterStatusDTO | null>(null),
    latestRequestDecision: shallowRef<SermonRequestDecisionEvent | null>(null)
  };
}

const sharedSermonState = createSermonState();

/** store 的 connectSocket() 订阅入口：服务端全量推送，原样保留（含未激活时的队列，供讲道台展示）。 */
export function applySermonState(state: SermonStateDTO) {
  sharedSermonState.sermonState.value = state && typeof state.active === "boolean" ? state : null;
}

export function applySermonRequestDecision(event: SermonRequestDecisionEvent) {
  if (!event || !Number.isInteger(event.messageId)) return;
  sharedSermonState.latestRequestDecision.value = {
    messageId: event.messageId,
    approve: !!event.approve,
    until: typeof event.until === "string" ? event.until : null
  };
}

/** 登出/换号时清掉会话内的 sermon 数据。 */
export function resetSermonState() {
  sharedSermonState.sermonState.value = null;
  sharedSermonState.presenterStatus.value = null;
  sharedSermonState.latestRequestDecision.value = null;
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
            finish({ ok: false, reason: "rejected", message: ack?.message || "操作被拒绝，可能没有讲道权限" });
            return;
          }
          finish({ ok: true, added: ack.added, errors: ack.errors });
        });
      } catch {
        finish({ ok: false, reason: "transport", message: "操作发送失败，请重试" });
      }
    });
  }

  const add = (references: string[]) => emit("sermon:add", { references });
  const reorder = (order: string[]) => emit("sermon:reorder", { order });
  const remove = (id: string) => emit("sermon:remove", { id });
  const present = (id: string | null) => emit("sermon:present", { id });
  const setFontScale = (scale: number) => emit("sermon:font-scale", { scale });
  const annotate = (itemId: string, annotation: SermonAnnotation) => emit("sermon:annotate", { itemId, annotation });
  const clearAnnotations = (itemId: string, verseIndex?: number, kind?: SermonAnnotationKind) =>
    emit("sermon:annotate:clear", { itemId, ...(verseIndex === undefined ? {} : { verseIndex }), ...(kind ? { kind } : {}) });
  const clearPresentation = () => emit("sermon:clear", {});

  async function refreshPresenterStatus() {
    state.presenterStatus.value = await request<SermonPresenterStatusDTO>("/api/sermon/presenter-status");
    return state.presenterStatus.value;
  }

  return {
    sermonState: state.sermonState,
    presenterStatus: state.presenterStatus,
    latestRequestDecision: state.latestRequestDecision,
    pending,
    statusMessage,
    add,
    reorder,
    remove,
    present,
    setFontScale,
    annotate,
    clearAnnotations,
    clearPresentation,
    refreshPresenterStatus
  };
}
