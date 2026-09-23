import { ref } from "vue";
import { HANDWRITING_CONTENT, normalizeHandwritingPayload, type HandwritingPayload } from "@shared/handwriting";
import type { MessageSendResult } from "../../messageSending";
import {
  createHandwritingDraftRepository,
  type HandwritingDraftRepository,
  type HandwritingDraftScope,
  type HandwritingPendingSend
} from "./handwritingDrafts";

export type HandwritingSendPayload = {
  channelId: number;
  type: "handwriting";
  content: typeof HANDWRITING_CONTENT;
  payload: HandwritingPayload;
  replyToId: number | null;
  clientRequestId: string;
};

export type HandwritingStatusResult = { state?: "sent" | "unknown"; messageId?: number };

export type HandwritingMessagingDependencies = {
  repository?: HandwritingDraftRepository;
  send(payload: HandwritingSendPayload): Promise<MessageSendResult>;
  checkStatus(clientRequestId: string): Promise<HandwritingStatusResult>;
  createRequestId?: () => string;
  now?: () => number;
};

export function useHandwritingMessaging(dependencies: HandwritingMessagingDependencies) {
  const repository = dependencies.repository || createHandwritingDraftRepository();
  const statusMessage = ref("");
  const pending = ref(false);
  const persistenceOperations = new Set<Promise<unknown>>();
  let generation = 0;

  function track<T>(operation: Promise<T>): Promise<T> {
    persistenceOperations.add(operation);
    operation.finally(() => persistenceOperations.delete(operation)).catch(() => undefined);
    return operation;
  }

  function outerPayload(scope: HandwritingDraftScope, pendingSend: HandwritingPendingSend): HandwritingSendPayload {
    return {
      channelId: scope.channelId,
      type: "handwriting",
      content: HANDWRITING_CONTENT,
      payload: pendingSend.payload,
      replyToId: pendingSend.replyToId,
      clientRequestId: pendingSend.clientRequestId
    };
  }

  async function confirm(scope: HandwritingDraftScope, clientRequestId: string, expectedGeneration = generation) {
    if (expectedGeneration !== generation) return false;
    const confirmed = await track(repository.confirmPending(scope, clientRequestId, () => expectedGeneration === generation));
    if (expectedGeneration !== generation) return false;
    if (confirmed) statusMessage.value = "";
    return confirmed;
  }

  async function deliver(scope: HandwritingDraftScope, pendingSend: HandwritingPendingSend) {
    if (pending.value) return { ok: false, reason: "busy", message: "消息正在发送，请稍候" } as const;
    const expectedGeneration = generation;
    pending.value = true;
    statusMessage.value = "正在发送手写消息…";
    try {
      const result = await dependencies.send(outerPayload(scope, pendingSend));
      if (expectedGeneration !== generation) return result;
      if (result.ok) await confirm(scope, pendingSend.clientRequestId, expectedGeneration);
      else if (result.code === "not_sent" || result.code === "conflict") {
        await repository.discardPending(scope, pendingSend.clientRequestId);
        if (expectedGeneration === generation) statusMessage.value = result.message;
      } else {
        statusMessage.value = result.message;
      }
      return result;
    } finally {
      if (expectedGeneration === generation) pending.value = false;
    }
  }

  async function submit(input: {
    scope: HandwritingDraftScope;
    payload: unknown;
    revision: number;
    replyToId: number | null;
  }) {
    const expectedGeneration = generation;
    const normalized = normalizeHandwritingPayload(input.payload);
    const pendingSend: HandwritingPendingSend = {
      clientRequestId: dependencies.createRequestId?.() || crypto.randomUUID(),
      revision: input.revision,
      payload: normalized,
      replyToId: input.replyToId,
      createdAt: dependencies.now?.() || Date.now()
    };
    try {
      await track(repository.savePending(input.scope, pendingSend));
    } catch (error) {
      statusMessage.value = error instanceof Error ? error.message : "无法保存未确认的手写消息";
      return { ok: false, reason: "transport", message: statusMessage.value } as const;
    }
    if (expectedGeneration !== generation) {
      return { ok: false, reason: "transport", message: "发送已停止" } as const;
    }
    return deliver(input.scope, pendingSend);
  }

  async function retry(scope: HandwritingDraftScope, clientRequestId: string) {
    const expectedGeneration = generation;
    const row = await repository.record(scope);
    if (expectedGeneration !== generation) return { ok: false, reason: "transport", message: "发送已停止" } as const;
    if (!row?.pending || row.pending.clientRequestId !== clientRequestId) {
      const message = "未找到需要重试的手写消息";
      statusMessage.value = message;
      return { ok: false, reason: "rejected", message } as const;
    }
    return deliver(scope, row.pending);
  }

  async function checkStatus(scope: HandwritingDraftScope, clientRequestId: string) {
    const expectedGeneration = generation;
    const result = await dependencies.checkStatus(clientRequestId);
    if (expectedGeneration !== generation) return result;
    if (result.state === "sent") await confirm(scope, clientRequestId, expectedGeneration);
    return result;
  }

  async function saveDraft(scope: HandwritingDraftScope, payload: unknown, revision: number) {
    const expectedGeneration = generation;
    try {
      await track(repository.saveDraft(scope, payload, revision, dependencies.now?.() || Date.now()));
      if (expectedGeneration === generation) statusMessage.value = "";
      return true;
    } catch (error) {
      statusMessage.value = error instanceof Error ? error.message : "无法保存手写草稿";
      return false;
    }
  }

  function stop() {
    generation += 1;
    pending.value = false;
  }

  async function clearAccount(accountId: number) {
    stop();
    await Promise.allSettled([...persistenceOperations]);
    await repository.clearAccount(accountId);
    statusMessage.value = "";
  }

  return { repository, pending, statusMessage, saveDraft, submit, retry, checkStatus, confirm, stop, clearAccount };
}
