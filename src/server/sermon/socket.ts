import { z } from "zod";
import type { Socket } from "socket.io";
import type { SermonAnnotation, SermonStateDTO } from "../../shared/types.js";
import { lookupBibleReference } from "../bible/lookup.js";
import { canPresentSermon } from "./permissions.js";
import { SERMON_FONT_SCALE_MAX, SERMON_FONT_SCALE_MIN, SERMON_QUEUE_LIMIT, type SermonActor, type SermonResolvedEntry, type SermonStateStore } from "./state.js";

type SermonSocketEmitter = {
  emit(event: string, payload: unknown): unknown;
};

export type SermonSocketAuth = {
  accountId: number;
};

export type SermonPresenterProfile = {
  isAdmin: boolean;
  displayName: string;
  sermonPresenterUntil: Date | null;
};

export type SermonSocketDeps = {
  refreshAuth(socket: Socket): Promise<SermonSocketAuth | null>;
  presenterAccount(accountId: number): Promise<SermonPresenterProfile | null>;
  store: SermonStateStore;
};

type SermonAck = ((payload: unknown) => void) | undefined;

const addSchema = z.object({
  references: z.array(z.string().trim().min(1).max(200)).min(1).max(20)
});
const reorderSchema = z.object({
  order: z.array(z.string().min(1).max(64)).max(SERMON_QUEUE_LIMIT * 2)
});
const removeSchema = z.object({ id: z.string().min(1).max(64) });
const presentSchema = z.object({ id: z.string().min(1).max(64).nullable() });
const fontScaleSchema = z.object({ scale: z.number().min(SERMON_FONT_SCALE_MIN).max(SERMON_FONT_SCALE_MAX) });
const annotateSchema = z.object({
  itemId: z.string().min(1).max(64),
  annotation: z.object({
    verseIndex: z.number().int().min(0),
    kind: z.enum(["highlight", "underline"]),
    start: z.number().int().min(0).optional(),
    end: z.number().int().min(0).optional()
  })
});
const annotateClearSchema = z.object({
  itemId: z.string().min(1).max(64),
  verseIndex: z.number().int().min(0).optional(),
  kind: z.enum(["highlight", "underline"]).optional()
});

export function registerSermonSocket(io: SermonSocketEmitter, socket: Socket, deps: SermonSocketDeps) {
  // 弱网约束：仅在展示激活时向新连接补发一次快照，平时无常态流量。
  const snapshot = deps.store.getState();
  if (snapshot.active) {
    socket.emit("sermon:state", snapshot);
  } else if (snapshot.queue.length) {
    // 队列未展示时只向有讲道权限的连接补发：讲道者断线重连后讲道台不丢队列，观众端不补发。
    void (async () => {
      const auth = await deps.refreshAuth(socket);
      if (!auth) return;
      const account = await deps.presenterAccount(auth.accountId);
      if (account && canPresentSermon(account) && socket.connected) {
        socket.emit("sermon:state", deps.store.getState());
      }
    })().catch(() => undefined);
  }

  async function authorizedPresenter(ack: SermonAck): Promise<SermonActor | null> {
    const auth = await deps.refreshAuth(socket);
    if (!auth) {
      ack?.({ ok: false, message: "认证失败" });
      return null;
    }
    const account = await deps.presenterAccount(auth.accountId);
    if (!account || !canPresentSermon(account)) {
      ack?.({ ok: false, message: "无讲道权限" });
      return null;
    }
    return { id: String(auth.accountId), name: account.displayName };
  }

  async function commit(ack: SermonAck, run: () => Promise<SermonStateDTO>, ok?: (state: SermonStateDTO) => Record<string, unknown>) {
    try {
      const state = await run();
      io.emit("sermon:state", state);
      ack?.({ ok: true, ...(ok ? ok(state) : {}) });
    } catch (error) {
      ack?.({ ok: false, message: error instanceof Error ? error.message : "操作失败" });
    }
  }

  function knownItem(id: string, ack: SermonAck): boolean {
    if (deps.store.getState().queue.some((item) => item.id === id)) return true;
    ack?.({ ok: false, message: "条目不存在" });
    return false;
  }

  socket.on("sermon:add", async (data: unknown, ack?: SermonAck) => {
    const actor = await authorizedPresenter(ack);
    if (!actor) return;
    const parsed = addSchema.safeParse(data);
    if (!parsed.success) {
      ack?.({ ok: false, message: "参数无效" });
      return;
    }
    const entries: SermonResolvedEntry[] = [];
    const errors: Array<{ reference: string; message: string }> = [];
    for (const reference of parsed.data.references) {
      try {
        const lookup = lookupBibleReference(reference);
        entries.push({ reference, normalizedReference: lookup.normalizedReference, verses: lookup.verses });
      } catch {
        errors.push({ reference, message: "无法识别该经文出处" });
      }
    }
    if (!entries.length) {
      ack?.({ ok: false, message: "没有可识别的经文出处", errors });
      return;
    }
    await commit(ack, () => deps.store.add(actor, entries), () => ({ added: entries.length, errors }));
  });

  socket.on("sermon:reorder", async (data: unknown, ack?: SermonAck) => {
    const actor = await authorizedPresenter(ack);
    if (!actor) return;
    const parsed = reorderSchema.safeParse(data);
    if (!parsed.success) {
      ack?.({ ok: false, message: "参数无效" });
      return;
    }
    await commit(ack, () => deps.store.reorder(actor, parsed.data.order));
  });

  socket.on("sermon:remove", async (data: unknown, ack?: SermonAck) => {
    const actor = await authorizedPresenter(ack);
    if (!actor) return;
    const parsed = removeSchema.safeParse(data);
    if (!parsed.success || !knownItem(parsed.data.id, ack)) return;
    await commit(ack, () => deps.store.remove(actor, parsed.data.id));
  });

  socket.on("sermon:present", async (data: unknown, ack?: SermonAck) => {
    const actor = await authorizedPresenter(ack);
    if (!actor) return;
    const parsed = presentSchema.safeParse(data);
    if (!parsed.success || (parsed.data.id !== null && !knownItem(parsed.data.id, ack))) return;
    await commit(ack, () => deps.store.present(actor, parsed.data.id));
  });

  socket.on("sermon:font-scale", async (data: unknown, ack?: SermonAck) => {
    const actor = await authorizedPresenter(ack);
    if (!actor) return;
    const parsed = fontScaleSchema.safeParse(data);
    if (!parsed.success) {
      ack?.({ ok: false, message: "参数无效" });
      return;
    }
    await commit(ack, () => deps.store.fontScale(actor, parsed.data.scale));
  });

  socket.on("sermon:annotate", async (data: unknown, ack?: SermonAck) => {
    const actor = await authorizedPresenter(ack);
    if (!actor) return;
    const parsed = annotateSchema.safeParse(data);
    if (!parsed.success || !knownItem(parsed.data.itemId, ack)) return;
    const annotation: SermonAnnotation = parsed.data.annotation;
    await commit(ack, () => deps.store.annotate(actor, parsed.data.itemId, annotation));
  });

  socket.on("sermon:annotate:clear", async (data: unknown, ack?: SermonAck) => {
    const actor = await authorizedPresenter(ack);
    if (!actor) return;
    const parsed = annotateClearSchema.safeParse(data);
    if (!parsed.success || !knownItem(parsed.data.itemId, ack)) return;
    await commit(ack, () =>
      deps.store.annotateClear(actor, parsed.data.itemId, { verseIndex: parsed.data.verseIndex, kind: parsed.data.kind })
    );
  });

  socket.on("sermon:clear", async (_data: unknown, ack?: SermonAck) => {
    const actor = await authorizedPresenter(ack);
    if (!actor) return;
    await commit(ack, () => deps.store.clear(actor));
  });
}
