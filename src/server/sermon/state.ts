import crypto from "node:crypto";
import { z } from "zod";
import type {
  BibleVerseLineDTO,
  SermonAnnotation,
  SermonAnnotationKind,
  SermonQueueItem,
  SermonStateDTO
} from "../../shared/types.js";

export const SERMON_QUEUE_LIMIT = 50;
export const SERMON_FONT_SCALE_MIN = 0.7;
export const SERMON_FONT_SCALE_MAX = 1.6;

export type SermonActor = {
  id: string;
  name: string;
};

export type SermonResolvedEntry = {
  reference: string;
  normalizedReference: string;
  verses: BibleVerseLineDTO[];
};

export type SermonMutationContext = {
  actor: SermonActor;
  createId: () => string;
  now: string;
};

export type SermonAnnotationClearFilter = {
  verseIndex?: number;
  kind?: SermonAnnotationKind;
};

export function emptySermonState(now = new Date().toISOString()): SermonStateDTO {
  return {
    active: false,
    queue: [],
    currentItemId: null,
    presenterId: "",
    presenterName: "",
    fontScale: 1,
    updatedAt: now
  };
}

function touch(state: SermonStateDTO, ctx: SermonMutationContext): SermonStateDTO {
  return { ...state, presenterId: ctx.actor.id, presenterName: ctx.actor.name, updatedAt: ctx.now };
}

function replaceQueueItem(state: SermonStateDTO, item: SermonQueueItem): SermonStateDTO {
  return { ...state, queue: state.queue.map((entry) => (entry.id === item.id ? item : entry)) };
}

export function applyAdd(state: SermonStateDTO, entries: SermonResolvedEntry[], ctx: SermonMutationContext): SermonStateDTO {
  const capacity = SERMON_QUEUE_LIMIT - state.queue.length;
  if (capacity <= 0 || !entries.length) return state;
  const items: SermonQueueItem[] = entries.slice(0, capacity).map((entry) => ({
    id: ctx.createId(),
    reference: entry.reference,
    normalizedReference: entry.normalizedReference,
    verses: entry.verses,
    annotations: []
  }));
  return touch({ ...state, queue: [...state.queue, ...items] }, ctx);
}

export function applyReorder(state: SermonStateDTO, order: string[], ctx: SermonMutationContext): SermonStateDTO {
  const byId = new Map(state.queue.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const reordered: SermonQueueItem[] = [];
  for (const id of order) {
    const item = byId.get(id);
    if (!item || seen.has(id)) continue;
    seen.add(id);
    reordered.push(item);
  }
  for (const item of state.queue) {
    if (!seen.has(item.id)) reordered.push(item);
  }
  return touch({ ...state, queue: reordered }, ctx);
}

export function applyRemove(state: SermonStateDTO, id: string, ctx: SermonMutationContext): SermonStateDTO {
  if (!state.queue.some((item) => item.id === id)) return state;
  const queue = state.queue.filter((item) => item.id !== id);
  const removedCurrent = state.currentItemId === id;
  return touch(
    {
      ...state,
      queue,
      currentItemId: removedCurrent ? null : state.currentItemId,
      active: removedCurrent ? false : state.active
    },
    ctx
  );
}

export function applyPresent(state: SermonStateDTO, id: string | null, ctx: SermonMutationContext): SermonStateDTO {
  if (id === null) {
    if (!state.active && state.currentItemId === null) return state;
    return touch({ ...state, active: false, currentItemId: null }, ctx);
  }
  if (!state.queue.some((item) => item.id === id)) return state;
  return touch({ ...state, active: true, currentItemId: id }, ctx);
}

// 字体倍率按 0.1 步进取整并夹在允许区间内；与当前值相同视为无操作。
export function applyFontScale(state: SermonStateDTO, scale: number, ctx: SermonMutationContext): SermonStateDTO {
  if (!Number.isFinite(scale)) return state;
  const clamped = Math.min(SERMON_FONT_SCALE_MAX, Math.max(SERMON_FONT_SCALE_MIN, Math.round(scale * 10) / 10));
  if (clamped === state.fontScale) return state;
  return touch({ ...state, fontScale: clamped }, ctx);
}

function validAnnotation(item: SermonQueueItem, annotation: SermonAnnotation): boolean {
  if (!Number.isInteger(annotation.verseIndex) || annotation.verseIndex < 0 || annotation.verseIndex >= item.verses.length) return false;
  if (annotation.start === undefined && annotation.end === undefined) return true;
  if (annotation.start === undefined || annotation.end === undefined) return false;
  const length = item.verses[annotation.verseIndex].text.length;
  return (
    Number.isInteger(annotation.start) &&
    Number.isInteger(annotation.end) &&
    annotation.start >= 0 &&
    annotation.end <= length &&
    annotation.start < annotation.end
  );
}

function sameAnnotation(left: SermonAnnotation, right: SermonAnnotation): boolean {
  return left.verseIndex === right.verseIndex && left.kind === right.kind && left.start === right.start && left.end === right.end;
}

// 完全相同的标注再次提交时视为切换（取消该标注），否则追加。
export function applyAnnotate(state: SermonStateDTO, itemId: string, annotation: SermonAnnotation, ctx: SermonMutationContext): SermonStateDTO {
  const item = state.queue.find((entry) => entry.id === itemId);
  if (!item || !validAnnotation(item, annotation)) return state;
  const exists = item.annotations.some((entry) => sameAnnotation(entry, annotation));
  const annotations = exists
    ? item.annotations.filter((entry) => !sameAnnotation(entry, annotation))
    : [...item.annotations, annotation];
  return touch(replaceQueueItem(state, { ...item, annotations }), ctx);
}

export function applyAnnotateClear(
  state: SermonStateDTO,
  itemId: string,
  filter: SermonAnnotationClearFilter,
  ctx: SermonMutationContext
): SermonStateDTO {
  const item = state.queue.find((entry) => entry.id === itemId);
  if (!item) return state;
  const annotations = item.annotations.filter(
    (entry) =>
      (filter.verseIndex !== undefined && entry.verseIndex !== filter.verseIndex) ||
      (filter.kind !== undefined && entry.kind !== filter.kind)
  );
  if (annotations.length === item.annotations.length) return state;
  return touch(replaceQueueItem(state, { ...item, annotations }), ctx);
}

export function applyClear(state: SermonStateDTO, ctx: SermonMutationContext): SermonStateDTO {
  if (!state.queue.length && !state.active && state.currentItemId === null) return state;
  return touch({ ...state, active: false, queue: [], currentItemId: null }, ctx);
}

const verseSchema = z.object({
  book: z.string(),
  chapter: z.number().int(),
  verse: z.number().int(),
  endVerse: z.number().int(),
  reference: z.string(),
  text: z.string()
});

const annotationSchema = z.object({
  verseIndex: z.number().int().min(0),
  kind: z.enum(["highlight", "underline"]),
  start: z.number().int().min(0).optional(),
  end: z.number().int().min(0).optional()
});

const queueItemSchema = z.object({
  id: z.string().min(1),
  reference: z.string(),
  normalizedReference: z.string(),
  verses: z.array(verseSchema),
  annotations: z.array(annotationSchema)
});

const stateSchema = z.object({
  active: z.boolean(),
  queue: z.array(queueItemSchema),
  currentItemId: z.string().nullable(),
  presenterId: z.string(),
  presenterName: z.string(),
  // 旧持久化数据没有 fontScale 字段，反序列化时按默认 1 兼容。
  fontScale: z.number().min(SERMON_FONT_SCALE_MIN).max(SERMON_FONT_SCALE_MAX).default(1),
  updatedAt: z.string()
});

export function serializeSermonState(state: SermonStateDTO): string {
  return JSON.stringify(state);
}

export function deserializeSermonState(raw: string | null | undefined): SermonStateDTO {
  if (!raw) return emptySermonState();
  try {
    const parsed = stateSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return emptySermonState();
    const state: SermonStateDTO = parsed.data;
    if (state.currentItemId && !state.queue.some((item) => item.id === state.currentItemId)) {
      return { ...state, active: false, currentItemId: null };
    }
    return state;
  } catch {
    return emptySermonState();
  }
}

export type SermonStatePersistence = {
  load(): Promise<string | null>;
  save(serialized: string): Promise<void>;
};

export function createSermonStateStore(deps: {
  persistence: SermonStatePersistence;
  createId?: () => string;
  now?: () => Date;
}) {
  const createId = deps.createId || (() => crypto.randomUUID());
  const now = deps.now || (() => new Date());
  let state = emptySermonState();

  async function mutate(actor: SermonActor, apply: (current: SermonStateDTO, ctx: SermonMutationContext) => SermonStateDTO) {
    state = apply(state, { actor, createId, now: now().toISOString() });
    await deps.persistence.save(serializeSermonState(state));
    return state;
  }

  return {
    async load() {
      state = deserializeSermonState(await deps.persistence.load());
      return state;
    },
    getState(): SermonStateDTO {
      return state;
    },
    add: (actor: SermonActor, entries: SermonResolvedEntry[]) => mutate(actor, (current, ctx) => applyAdd(current, entries, ctx)),
    reorder: (actor: SermonActor, order: string[]) => mutate(actor, (current, ctx) => applyReorder(current, order, ctx)),
    remove: (actor: SermonActor, id: string) => mutate(actor, (current, ctx) => applyRemove(current, id, ctx)),
    present: (actor: SermonActor, id: string | null) => mutate(actor, (current, ctx) => applyPresent(current, id, ctx)),
    fontScale: (actor: SermonActor, scale: number) => mutate(actor, (current, ctx) => applyFontScale(current, scale, ctx)),
    annotate: (actor: SermonActor, itemId: string, annotation: SermonAnnotation) =>
      mutate(actor, (current, ctx) => applyAnnotate(current, itemId, annotation, ctx)),
    annotateClear: (actor: SermonActor, itemId: string, filter: SermonAnnotationClearFilter) =>
      mutate(actor, (current, ctx) => applyAnnotateClear(current, itemId, filter, ctx)),
    clear: (actor: SermonActor) => mutate(actor, (current, ctx) => applyClear(current, ctx))
  };
}

export type SermonStateStore = ReturnType<typeof createSermonStateStore>;
