import { getCurrentScope, onScopeDispose, ref, shallowRef, watch } from "vue";
import type { StoryCommentDTO, StoryInteractionsDTO } from "@shared/stories";
import { normalizeHandwritingPayload, type HandwritingPayload } from "@shared/handwriting";
import type { HandwritingDraftRepository, HandwritingDraftScope, HandwritingPendingSend } from "../handwriting/handwritingDrafts";
import type { HandwritingComposerSnapshot } from "../handwriting/useHandwritingComposer";
import { addStoryComment } from "./storyClient";
import { createStoryHandwritingDraftRepository } from "./storyHandwritingDrafts";

type Options = {
  accountId(): number;
  storyId(): number;
  onUpdated(interactions: StoryInteractionsDTO): void;
  repository?: HandwritingDraftRepository;
  post?: typeof addStoryComment;
};

export function useStoryHandwritingReply(options: Options) {
  const repository = options.repository || createStoryHandwritingDraftRepository();
  const handwritingOpen = ref(false);
  const handwritingBusy = ref(false);
  const handwritingError = ref("");
  const persistenceError = ref("");
  const replyLabel = ref("");
  const draftState = shallowRef<HandwritingComposerSnapshot>({ key: "", payload: null, revision: 0 });
  let session: { scope: HandwritingDraftScope; generation: number } | null = null;
  let generation = 0;
  let disposed = false;
  let controller: AbortController | null = null;
  let operations = Promise.resolve();
  const retained = new Map<string, HandwritingComposerSnapshot>();
  const errors = new Map<string, { submission: string; persistence: string }>();
  const attempts = new Map<string, HandwritingPendingSend>();
  function key(scope: HandwritingDraftScope) { return `${scope.accountId}:${scope.actorId}:${scope.channelId}`; }
  function rememberErrors(active: NonNullable<typeof session>) {
    errors.set(key(active.scope), { submission: handwritingError.value, persistence: persistenceError.value });
  }

  function isCurrent(active: NonNullable<typeof session>) {
    return !disposed && session === active && active.generation === generation &&
      active.scope.accountId === options.accountId() && active.scope.actorId === options.storyId();
  }
  function persist(active: NonNullable<typeof session>, action: () => Promise<unknown>) {
    const operation = operations.then(action).then(() => {
      if (isCurrent(active)) { persistenceError.value = ""; rememberErrors(active); }
      return true;
    }).catch((cause: unknown) => {
      if (isCurrent(active)) {
        persistenceError.value = cause instanceof Error ? `草稿保存失败：${cause.message}` : "草稿保存失败，关闭页面前请重试";
        rememberErrors(active);
      }
      return false;
    });
    operations = operation.then(() => undefined);
    return operation;
  }
  async function open(reply: StoryCommentDTO | null) {
    if (handwritingBusy.value || !options.accountId() || disposed) return;
    const active = {
      scope: { accountId: options.accountId(), actorId: options.storyId(), channelId: reply?.id || 0 },
      generation: ++generation
    };
    session = active;
    handwritingBusy.value = true;
    handwritingError.value = errors.get(key(active.scope))?.submission || "";
    persistenceError.value = errors.get(key(active.scope))?.persistence || "";
    replyLabel.value = reply ? `${reply.author.displayName}：${reply.text || "手写回复"}` : "";
    await operations;
    try {
      const saved = await repository.record(active.scope);
      if (!isCurrent(active)) return;
      if (saved?.pending && !retained.has(key(active.scope)) && !attempts.has(key(active.scope))) attempts.set(key(active.scope), saved.pending);
      const draft = retained.get(key(active.scope)) || saved?.draft || saved?.pending;
      draftState.value = { key: `${active.scope.accountId}:${active.scope.actorId}:${active.scope.channelId}:${generation}`, payload: draft?.payload || null, revision: draft?.revision || 0 };
      handwritingOpen.value = true;
    } catch (cause) {
      if (isCurrent(active)) handwritingError.value = cause instanceof Error ? cause.message : "读取手写草稿失败，请重试";
    } finally {
      if (isCurrent(active)) handwritingBusy.value = false;
    }
  }
  function close() {
    if (!handwritingBusy.value) handwritingOpen.value = false;
  }
  function saveDraft(payload: HandwritingPayload | null, revision: number) {
    const active = session;
    if (!active || !isCurrent(active)) return Promise.resolve(false);
    // Keep a recoverable in-memory snapshot even if IndexedDB fails.
    const snapshot = { ...draftState.value, payload, revision };
    retained.set(key(active.scope), snapshot);
    return persist(active, () => payload ? repository.saveDraft(active.scope, payload, revision) : repository.clearDraft(active.scope));
  }
  async function submit(payload: HandwritingPayload, revision: number) {
    const active = session;
    if (!active || !isCurrent(active) || !handwritingOpen.value || handwritingBusy.value) return;
    handwritingBusy.value = true;
    handwritingError.value = "";
    const request = new AbortController();
    const timeout = setTimeout(() => request.abort(), 120_000);
    controller = request;
    try {
      const handwriting = normalizeHandwritingPayload(payload);
      await saveDraft(payload, revision);
      if (!isCurrent(active)) return;
      const attemptKey = key(active.scope);
      let attempt = attempts.get(attemptKey);
      if (!attempt || JSON.stringify(attempt.payload) !== JSON.stringify(handwriting)) {
        attempt = { clientRequestId: crypto.randomUUID(), payload: handwriting, revision, replyToId: active.scope.channelId || null, createdAt: Date.now() };
        attempts.set(attemptKey, attempt);
      }
      const pending = attempt;
      const stored = await persist(active, async () => {
        const existing = await repository.record(active.scope);
        if (existing?.pending && existing.pending.clientRequestId !== pending.clientRequestId) await repository.discardPending(active.scope, existing.pending.clientRequestId);
        await repository.savePending(active.scope, pending);
      });
      if (!stored) {
        if (isCurrent(active)) { handwritingError.value = "无法保存发送记录，手写内容已保留，请重试"; rememberErrors(active); }
        return;
      }
      if (!isCurrent(active)) return;
      const response = await (options.post || addStoryComment)(active.scope.actorId, {
        handwriting,
        clientRequestId: pending.clientRequestId,
        ...(active.scope.channelId ? { replyToId: active.scope.channelId } : {})
      }, undefined, request.signal);
      if (!isCurrent(active) || request.signal.aborted) return;
      options.onUpdated(response.interactions);
      attempts.delete(attemptKey);
      retained.set(key(active.scope), { key: `${key(active.scope)}:sent:${generation}`, payload: null, revision: 0 });
      await persist(active, async () => {
        await repository.confirmPending(active.scope, pending.clientRequestId);
        await repository.clearDraft(active.scope);
      });
      if (!isCurrent(active)) return;
      draftState.value = { key: `${key(active.scope)}:sent:${generation}`, payload: null, revision: 0 };
      handwritingOpen.value = false;
    } catch (cause) {
      if (isCurrent(active)) {
        handwritingError.value = request.signal.aborted ? "发送超时，手写内容已保留，请重试" : cause instanceof Error ? cause.message : "手写回复发送失败，请重试";
        rememberErrors(active);
      }
    } finally {
      clearTimeout(timeout);
      if (controller === request) controller = null;
      if (isCurrent(active)) handwritingBusy.value = false;
    }
  }
  function reset() {
    generation += 1;
    controller?.abort();
    handwritingOpen.value = false;
    handwritingBusy.value = false;
    handwritingError.value = "";
    persistenceError.value = "";
    session = null;
  }
  watch([() => options.accountId(), () => options.storyId()], reset, { flush: "sync" });
  if (getCurrentScope()) onScopeDispose(() => { disposed = true; reset(); });
  return { handwritingOpen, handwritingBusy, handwritingError, persistenceError, draftState, replyLabel, open, close, saveDraft, submit };
}
