import { z } from "zod";
import type { Socket } from "socket.io";
import type { SermonAnnotation, SermonEndedEvent, SermonInvitedEvent, SermonPresentationPreviewEvent, SermonRemovedEvent, SermonStateDTO } from "../../shared/types.js";
import { lookupBibleReference } from "../bible/lookup.js";
import { SermonPresentationError, SermonSeatConflictError, type PresentationRecord, type SermonPresentationService } from "./presentations.js";
import {
  SERMON_FONT_FAMILIES,
  SERMON_FONT_SCALE_MAX,
  SERMON_FONT_SCALE_MIN,
  SERMON_MARGIN_PCT_MAX,
  SERMON_MARGIN_PCT_MIN,
  SERMON_QUEUE_LIMIT,
  SERMON_TEXT_COLOR_HEX_RE,
  isValidSermonBackground,
  resolveSermonSlide,
  resolveSermonSlides,
  type SermonActor
} from "./state.js";

// 状态广播走房间定向（to(room).emit），目录变更走全局 emit；真实 socket.io Server 天然满足。
export type SermonSocketEmitter = {
  to(room: string): { emit(event: string, payload: unknown): unknown };
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
  service: SermonPresentationService;
  /** 把某账号的全部 socket 移出演示房间（移除观众/结束演示时强制离房）。 */
  socketsLeave(accountId: number, room: string): void;
};

type SermonAck = ((payload: unknown) => void) | undefined;

// 剔除控制字符（保留换行/制表）后再校验长度与非空。
const stripControlChars = (value: string) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");

const slideBlockInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("reference"),
    reference: z.string().transform(stripControlChars).pipe(z.string().trim().min(1).max(200))
  }),
  z.object({
    type: z.literal("text"),
    content: z.string().transform(stripControlChars).pipe(z.string().trim().min(1).max(4000))
  })
]);
const slideInputSchema = z.object({ blocks: z.array(slideBlockInputSchema).min(1).max(40) });
const SERMON_MAX_REFERENCES = 20;
const addSchema = z
  .object({ slides: z.array(slideInputSchema).min(1).max(20) })
  .refine(
    (payload) =>
      payload.slides.reduce((sum, slide) => sum + slide.blocks.filter((block) => block.type === "reference").length, 0) <= SERMON_MAX_REFERENCES,
    { message: "too many references" }
  );
const updateSchema = z.object({ id: z.string().min(1).max(64), slide: slideInputSchema });
const scrollSchema = z.object({ id: z.string().min(1).max(64), lines: z.number().int().min(0).max(10000) });
// 自由文字条目：剔除控制字符（保留换行/制表）后再校验长度与非空。
const addTextSchema = z.object({
  texts: z
    .array(
      z.object({
        title: z.string().transform(stripControlChars).pipe(z.string().trim().max(100)).optional(),
        content: z.string().transform(stripControlChars).pipe(z.string().trim().min(1).max(4000))
      })
    )
    .min(1)
    .max(20)
});
const reorderSchema = z.object({
  order: z.array(z.string().min(1).max(64)).max(SERMON_QUEUE_LIMIT * 2)
});
const removeSchema = z.object({ id: z.string().min(1).max(64) });
const presentSchema = z.object({ id: z.string().min(1).max(64).nullable() });
const displaySchema = z
  .object({
    fontFamily: z.enum(SERMON_FONT_FAMILIES).optional(),
    fontScale: z.number().min(SERMON_FONT_SCALE_MIN).max(SERMON_FONT_SCALE_MAX).optional(),
    marginPct: z.number().int().min(SERMON_MARGIN_PCT_MIN).max(SERMON_MARGIN_PCT_MAX).optional(),
    background: z.string().refine(isValidSermonBackground).optional(),
    textColor: z.string().regex(SERMON_TEXT_COLOR_HEX_RE).optional()
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0);
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

const SERMON_MAX_INVITES = 500;
const startSchema = z.object({
  scope: z.enum(["group", "assembly"]),
  invitedAccountIds: z.array(z.number().int().positive()).max(SERMON_MAX_INVITES).optional()
});
const joinSchema = z.object({ presenterId: z.number().int().positive() });
const inviteSchema = z.object({ accountIds: z.array(z.number().int().positive()).min(1).max(SERMON_MAX_INVITES) });
const removeViewerSchema = z.object({ accountId: z.number().int().positive() });
const endSchema = z.object({ presenterId: z.number().int().positive().optional() });
const planIdSchema = z.object({ id: z.string().trim().min(1).max(64) });
const planSaveSchema = z.object({
  id: z.string().trim().min(1).max(64).optional(),
  title: z.string().transform(stripControlChars).pipe(z.string().trim().min(1).max(80))
});

export function registerSermonSocket(io: SermonSocketEmitter, socket: Socket, deps: SermonSocketDeps) {
  const service = deps.service;
  const roomOf = (presenterAccountId: number) => `sermon:${presenterAccountId}`;

  function broadcastDirectory() {
    io.emit("sermon:directory", service.directory());
  }

  /** 全体演示可全局预览；小组演示的画面只定向发给受邀账号。 */
  function broadcastPreview(record: PresentationRecord) {
    const summary = service.directory(record.presenterAccountId).find((entry) => entry.presenterId === record.presenterAccountId);
    const event: SermonPresentationPreviewEvent = { presenterId: record.presenterAccountId, preview: summary?.preview ?? null };
    if (record.scope === "assembly") {
      io.emit("sermon:preview", event);
      return;
    }
    for (const accountId of record.invited) io.to(`acct:${accountId}`).emit("sermon:preview", event);
  }

  function failureMessage(error: unknown): string {
    return error instanceof Error ? error.message : "操作失败";
  }

  function ackFailure(ack: SermonAck, error: unknown) {
    if (error instanceof SermonSeatConflictError) {
      ack?.({ ok: false, code: error.code, message: error.message });
      return;
    }
    if (error instanceof SermonPresentationError || error instanceof Error) {
      ack?.({ ok: false, message: failureMessage(error) });
      return;
    }
    ack?.({ ok: false, message: "操作失败" });
  }

  // 连接快照：主持人补发自己演示的完整状态（含未激活队列）；已入座观众补发所坐演示的激活状态。
  void (async () => {
    try {
      const auth = await deps.refreshAuth(socket);
      if (!auth) return;
      const own = service.get(auth.accountId);
      if (own) {
        socket.join(roomOf(auth.accountId));
        socket.emit("sermon:state", own.store.getState());
      }
      const seated = service.seatOf(auth.accountId);
      if (seated === null) return;
      const record = service.get(seated);
      socket.join(roomOf(seated));
      if (record && record.store.getState().active) socket.emit("sermon:state", record.store.getState());
    } catch {
      // 快照补发失败不影响连接本身。
    }
  })();

  async function authenticated(ack: SermonAck): Promise<{ accountId: number; profile: SermonPresenterProfile } | null> {
    const auth = await deps.refreshAuth(socket);
    if (!auth) {
      ack?.({ ok: false, message: "认证失败" });
      return null;
    }
    const profile = await deps.presenterAccount(auth.accountId);
    if (!profile) {
      ack?.({ ok: false, message: "账号不存在" });
      return null;
    }
    return { accountId: auth.accountId, profile };
  }

  // 变更类事件操作调用者自己的演示：有演示即主持人（小组发起人可无讲道授权）。
  async function ownedPresentation(ack: SermonAck) {
    const session = await authenticated(ack);
    if (!session) return null;
    const record = service.get(session.accountId);
    if (!record) {
      ack?.({ ok: false, message: "请先开始演示" });
      return null;
    }
    return { ...session, record, actor: { id: String(session.accountId), name: session.profile.displayName } as SermonActor };
  }

  async function commit(
    ack: SermonAck,
    presenterAccountId: number,
    run: () => Promise<SermonStateDTO>,
    ok?: (state: SermonStateDTO) => Record<string, unknown>,
    refreshDirectory = false
  ) {
    try {
      const state = await run();
      io.to(roomOf(presenterAccountId)).emit("sermon:state", state);
      if (refreshDirectory) {
        broadcastDirectory();
        const record = service.get(presenterAccountId);
        if (record) broadcastPreview(record);
      }
      ack?.({ ok: true, ...(ok ? ok(state) : {}) });
    } catch (error) {
      ack?.({ ok: false, message: failureMessage(error) });
    }
  }

  function knownItem(queue: SermonStateDTO["queue"], id: string, ack: SermonAck): boolean {
    if (queue.some((item) => item.id === id)) return true;
    ack?.({ ok: false, message: "条目不存在" });
    return false;
  }

  // 识别失败降级为文字的出处：原文保留进屏内，ack 里提示讲道者。
  function fallbackNotice(fallbacks: string[]) {
    return fallbacks.map((reference) => ({ reference, message: "无法识别该经文出处，已作为文字加入" }));
  }

  socket.on("sermon:start", async (data: unknown, ack?: SermonAck) => {
    const session = await authenticated(ack);
    if (!session) return;
    const parsed = startSchema.safeParse(data);
    if (!parsed.success) {
      ack?.({ ok: false, message: "参数无效" });
      return;
    }
    try {
      const { record, invited } = await service.start(
        { accountId: session.accountId, displayName: session.profile.displayName },
        parsed.data.scope,
        parsed.data.invitedAccountIds ?? []
      );
      socket.join(roomOf(session.accountId));
      io.to(roomOf(session.accountId)).emit("sermon:state", record.store.getState());
      const notice: SermonInvitedEvent = {
        presenterId: record.presenterAccountId,
        presenterName: record.presenterName,
        scope: record.scope
      };
      for (const accountId of invited) io.to(`acct:${accountId}`).emit("sermon:invited", notice);
      broadcastDirectory();
      broadcastPreview(record);
      ack?.({ ok: true });
    } catch (error) {
      ackFailure(ack, error);
    }
  });

  socket.on("sermon:join", async (data: unknown, ack?: SermonAck) => {
    const session = await authenticated(ack);
    if (!session) return;
    const parsed = joinSchema.safeParse(data);
    if (!parsed.success) {
      ack?.({ ok: false, message: "参数无效" });
      return;
    }
    try {
      const record = await service.join(session.accountId, parsed.data.presenterId);
      socket.join(roomOf(parsed.data.presenterId));
      // 观众只需跟随激活展示；未激活时不补发队列。
      if (record.store.getState().active) socket.emit("sermon:state", record.store.getState());
      broadcastDirectory();
      ack?.({ ok: true });
    } catch (error) {
      ackFailure(ack, error);
    }
  });

  socket.on("sermon:leave", async (_data: unknown, ack?: SermonAck) => {
    const session = await authenticated(ack);
    if (!session) return;
    const released = service.releaseSeats(session.accountId);
    if (released !== null) {
      socket.leave(roomOf(released));
      broadcastDirectory();
    }
    ack?.({ ok: true });
  });

  socket.on("sermon:invite", async (data: unknown, ack?: SermonAck) => {
    const owned = await ownedPresentation(ack);
    if (!owned) return;
    const parsed = inviteSchema.safeParse(data);
    if (!parsed.success) {
      ack?.({ ok: false, message: "参数无效" });
      return;
    }
    try {
      const added = await service.invite(owned.accountId, parsed.data.accountIds);
      const notice: SermonInvitedEvent = {
        presenterId: owned.record.presenterAccountId,
        presenterName: owned.record.presenterName,
        scope: owned.record.scope
      };
      for (const accountId of added) io.to(`acct:${accountId}`).emit("sermon:invited", notice);
      broadcastDirectory();
      broadcastPreview(owned.record);
      ack?.({ ok: true, added: added.length });
    } catch (error) {
      ackFailure(ack, error);
    }
  });

  socket.on("sermon:plans", async (_data: unknown, ack?: SermonAck) => {
    const session = await authenticated(ack);
    if (!session) return;
    try {
      ack?.({ ok: true, plans: await service.plans(session.accountId) });
    } catch (error) {
      ackFailure(ack, error);
    }
  });

  socket.on("sermon:plan-save", async (data: unknown, ack?: SermonAck) => {
    const owned = await ownedPresentation(ack);
    if (!owned) return;
    const parsed = planSaveSchema.safeParse(data);
    if (!parsed.success) {
      ack?.({ ok: false, message: "方案名称无效" });
      return;
    }
    try {
      const plans = await service.savePlan(owned.accountId, parsed.data.title, parsed.data.id);
      ack?.({ ok: true, plans });
    } catch (error) {
      ackFailure(ack, error);
    }
  });

  socket.on("sermon:plan-load", async (data: unknown, ack?: SermonAck) => {
    const owned = await ownedPresentation(ack);
    if (!owned) return;
    const parsed = planIdSchema.safeParse(data);
    if (!parsed.success) {
      ack?.({ ok: false, message: "参数无效" });
      return;
    }
    try {
      const outcome = await service.loadPlan(owned.accountId, owned.actor, parsed.data.id);
      io.to(roomOf(owned.accountId)).emit("sermon:state", outcome.state);
      broadcastDirectory();
      broadcastPreview(owned.record);
      ack?.({ ok: true, plans: outcome.plans });
    } catch (error) {
      ackFailure(ack, error);
    }
  });

  socket.on("sermon:plan-delete", async (data: unknown, ack?: SermonAck) => {
    const session = await authenticated(ack);
    if (!session) return;
    const parsed = planIdSchema.safeParse(data);
    if (!parsed.success) {
      ack?.({ ok: false, message: "参数无效" });
      return;
    }
    try {
      ack?.({ ok: true, plans: await service.deletePlan(session.accountId, parsed.data.id) });
    } catch (error) {
      ackFailure(ack, error);
    }
  });

  socket.on("sermon:remove-viewer", async (data: unknown, ack?: SermonAck) => {
    const owned = await ownedPresentation(ack);
    if (!owned) return;
    const parsed = removeViewerSchema.safeParse(data);
    if (!parsed.success) {
      ack?.({ ok: false, message: "参数无效" });
      return;
    }
    if (!service.removeViewer(owned.accountId, parsed.data.accountId)) {
      ack?.({ ok: false, message: "该账号不在观众席中" });
      return;
    }
    const removed: SermonRemovedEvent = {
      presenterId: owned.record.presenterAccountId,
      presenterName: owned.record.presenterName
    };
    io.to(`acct:${parsed.data.accountId}`).emit("sermon:removed", removed);
    deps.socketsLeave(parsed.data.accountId, roomOf(owned.record.presenterAccountId));
    broadcastDirectory();
    ack?.({ ok: true });
  });

  socket.on("sermon:end", async (data: unknown, ack?: SermonAck) => {
    const session = await authenticated(ack);
    if (!session) return;
    const parsed = endSchema.safeParse(data ?? {});
    if (!parsed.success) {
      ack?.({ ok: false, message: "参数无效" });
      return;
    }
    try {
      const ended = await service.end(session.accountId, session.profile.isAdmin, parsed.data.presenterId);
      const room = roomOf(ended.presenterAccountId);
      // 房间内广播最终状态（已清空、active:false），再通知曾在场账号演示已结束。
      io.to(room).emit("sermon:state", ended.state);
      const notice: SermonEndedEvent = { presenterId: ended.presenterAccountId, presenterName: ended.presenterName };
      for (const accountId of new Set([...ended.audience, ...ended.invited])) {
        io.to(`acct:${accountId}`).emit("sermon:ended", notice);
      }
      for (const accountId of ended.audience) deps.socketsLeave(accountId, room);
      deps.socketsLeave(ended.presenterAccountId, room);
      if (ended.presenterAccountId === session.accountId) socket.leave(room);
      broadcastDirectory();
      ack?.({ ok: true });
    } catch (error) {
      ackFailure(ack, error);
    }
  });

  socket.on("sermon:add", async (data: unknown, ack?: SermonAck) => {
    const owned = await ownedPresentation(ack);
    if (!owned) return;
    const parsed = addSchema.safeParse(data);
    if (!parsed.success) {
      ack?.({ ok: false, message: "参数无效" });
      return;
    }
    const { resolved, fallbacks } = resolveSermonSlides(parsed.data.slides, lookupBibleReference);
    if (!resolved.length) {
      ack?.({ ok: false, message: "没有可加入的内容", errors: fallbackNotice(fallbacks) });
      return;
    }
    await commit(ack, owned.accountId, () => owned.record.store.add(owned.actor, resolved), () => ({
      added: resolved.length,
      errors: fallbackNotice(fallbacks)
    }));
  });

  socket.on("sermon:update", async (data: unknown, ack?: SermonAck) => {
    const owned = await ownedPresentation(ack);
    if (!owned) return;
    const parsed = updateSchema.safeParse(data);
    if (!parsed.success) {
      ack?.({ ok: false, message: "参数无效" });
      return;
    }
    if (!knownItem(owned.record.store.getState().queue, parsed.data.id, ack)) return;
    const outcome = resolveSermonSlide(parsed.data.slide, lookupBibleReference);
    if (!outcome) {
      ack?.({ ok: false, message: "内容为空" });
      return;
    }
    await commit(ack, owned.accountId, () => owned.record.store.update(owned.actor, parsed.data.id, outcome.resolved), () => ({
      errors: fallbackNotice(outcome.fallbacks)
    }), true);
  });

  socket.on("sermon:scroll", async (data: unknown, ack?: SermonAck) => {
    const owned = await ownedPresentation(ack);
    if (!owned) return;
    const parsed = scrollSchema.safeParse(data);
    if (!parsed.success) {
      ack?.({ ok: false, message: "参数无效" });
      return;
    }
    if (!knownItem(owned.record.store.getState().queue, parsed.data.id, ack)) return;
    await commit(ack, owned.accountId, () => owned.record.store.scroll(owned.actor, parsed.data.id, parsed.data.lines));
  });

  socket.on("sermon:add-text", async (data: unknown, ack?: SermonAck) => {
    const owned = await ownedPresentation(ack);
    if (!owned) return;
    const parsed = addTextSchema.safeParse(data);
    if (!parsed.success) {
      ack?.({ ok: false, message: "参数无效" });
      return;
    }
    await commit(ack, owned.accountId, () => owned.record.store.addTexts(owned.actor, parsed.data.texts), () => ({
      added: parsed.data.texts.length
    }));
  });

  socket.on("sermon:reorder", async (data: unknown, ack?: SermonAck) => {
    const owned = await ownedPresentation(ack);
    if (!owned) return;
    const parsed = reorderSchema.safeParse(data);
    if (!parsed.success) {
      ack?.({ ok: false, message: "参数无效" });
      return;
    }
    await commit(ack, owned.accountId, () => owned.record.store.reorder(owned.actor, parsed.data.order));
  });

  socket.on("sermon:remove", async (data: unknown, ack?: SermonAck) => {
    const owned = await ownedPresentation(ack);
    if (!owned) return;
    const parsed = removeSchema.safeParse(data);
    if (!parsed.success || !knownItem(owned.record.store.getState().queue, parsed.data.id, ack)) return;
    await commit(ack, owned.accountId, () => owned.record.store.remove(owned.actor, parsed.data.id), undefined, true);
  });

  socket.on("sermon:present", async (data: unknown, ack?: SermonAck) => {
    const owned = await ownedPresentation(ack);
    if (!owned) return;
    const parsed = presentSchema.safeParse(data);
    if (!parsed.success || (parsed.data.id !== null && !knownItem(owned.record.store.getState().queue, parsed.data.id, ack))) return;
    await commit(ack, owned.accountId, () => owned.record.store.present(owned.actor, parsed.data.id), undefined, true);
  });

  socket.on("sermon:display", async (data: unknown, ack?: SermonAck) => {
    const owned = await ownedPresentation(ack);
    if (!owned) return;
    const parsed = displaySchema.safeParse(data);
    if (!parsed.success) {
      ack?.({ ok: false, message: "参数无效" });
      return;
    }
    await commit(ack, owned.accountId, () => owned.record.store.display(owned.actor, parsed.data), undefined, true);
  });

  socket.on("sermon:annotate", async (data: unknown, ack?: SermonAck) => {
    const owned = await ownedPresentation(ack);
    if (!owned) return;
    const parsed = annotateSchema.safeParse(data);
    if (!parsed.success || !knownItem(owned.record.store.getState().queue, parsed.data.itemId, ack)) return;
    const annotation: SermonAnnotation = parsed.data.annotation;
    await commit(ack, owned.accountId, () => owned.record.store.annotate(owned.actor, parsed.data.itemId, annotation), undefined, true);
  });

  socket.on("sermon:annotate:clear", async (data: unknown, ack?: SermonAck) => {
    const owned = await ownedPresentation(ack);
    if (!owned) return;
    const parsed = annotateClearSchema.safeParse(data);
    if (!parsed.success || !knownItem(owned.record.store.getState().queue, parsed.data.itemId, ack)) return;
    await commit(
      ack,
      owned.accountId,
      () => owned.record.store.annotateClear(owned.actor, parsed.data.itemId, { verseIndex: parsed.data.verseIndex, kind: parsed.data.kind }),
      undefined,
      true
    );
  });

  socket.on("sermon:clear", async (_data: unknown, ack?: SermonAck) => {
    const owned = await ownedPresentation(ack);
    if (!owned) return;
    await commit(ack, owned.accountId, () => owned.record.store.clear(owned.actor), undefined, true);
  });
}
