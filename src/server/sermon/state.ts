import crypto from "node:crypto";
import { z } from "zod";
import type {
  BibleLookupDTO,
  BibleVerseLineDTO,
  SermonAnnotation,
  SermonAnnotationKind,
  SermonDisplayDTO,
  SermonQueueItem,
  SermonSlideBlock,
  SermonPresentationScope,
  SermonSlideInput,
  SermonStateDTO,
  SermonTextInput
} from "../../shared/types.js";

export const SERMON_QUEUE_LIMIT = 50;
export const SERMON_FONT_SCALE_MIN = 0.7;
export const SERMON_FONT_SCALE_MAX = 1.6;
export const SERMON_MARGIN_PCT_MIN = 0;
export const SERMON_MARGIN_PCT_MAX = 20;
export const SERMON_FONT_FAMILIES = ["songti", "pingfang", "heiti", "kaiti"] as const;
export const SERMON_BACKGROUND_PRESETS = ["gradient", "aurora", "sunset", "forest", "dawn", "dark", "light", "sepia", "midnight"] as const;
export const SERMON_BACKGROUND_HEX_RE = /^#[0-9a-fA-F]{6}$/;
export const SERMON_TEXT_COLOR_HEX_RE = SERMON_BACKGROUND_HEX_RE;
export const DEFAULT_SERMON_TEXT_COLOR = "#f8f4e8";

export const DEFAULT_SERMON_DISPLAY: SermonDisplayDTO = {
  fontFamily: "songti",
  fontScale: 1,
  marginPct: 4,
  background: "gradient",
  textColor: DEFAULT_SERMON_TEXT_COLOR
};

export function isValidSermonBackground(value: string): boolean {
  return (SERMON_BACKGROUND_PRESETS as readonly string[]).includes(value) || SERMON_BACKGROUND_HEX_RE.test(value);
}

export type SermonActor = {
  id: string;
  name: string;
};

/** 一屏内容的解析结果：有序块 + 扁平经文数组 + 供热编辑的原文重建。 */
export type SermonResolvedSlide = {
  blocks: SermonSlideBlock[];
  verses: BibleVerseLineDTO[];
  source: string;
};

export type SermonSlidesResolution = {
  resolved: SermonResolvedSlide[];
  /** 识别失败降级为文字的出处（原文保留，提示讲道者）。 */
  fallbacks: string[];
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
    // 新演示默认小组范围；持久化数据缺该字段时按集会迁移（见 stateSchema）。
    scope: "group",
    display: { ...DEFAULT_SERMON_DISPLAY },
    updatedAt: now
  };
}

function touch(state: SermonStateDTO, ctx: SermonMutationContext): SermonStateDTO {
  return { ...state, presenterId: ctx.actor.id, presenterName: ctx.actor.name, updatedAt: ctx.now };
}

function replaceQueueItem(state: SermonStateDTO, item: SermonQueueItem): SermonStateDTO {
  return { ...state, queue: state.queue.map((entry) => (entry.id === item.id ? item : entry)) };
}

/**
 * 把客户端解析后的屏解析成可入库的结构：reference 块经文查询，失败降级为文字块（原文保留）；
 * 整屏无内容返回 null。verses 为全屏经文扁平数组，passage 块用 verseStart/verseCount 引用切片。
 */
export function resolveSermonSlide(
  slide: SermonSlideInput,
  resolve: (reference: string) => BibleLookupDTO
): { resolved: SermonResolvedSlide; fallbacks: string[] } | null {
  const blocks: SermonSlideBlock[] = [];
  const verses: BibleVerseLineDTO[] = [];
  const fallbacks: string[] = [];
  for (const block of slide.blocks) {
    if (block.type === "text") {
      const content = block.content.trim();
      if (content) blocks.push({ type: "text", content });
      continue;
    }
    try {
      const lookup = resolve(block.reference);
      if (!lookup.verses.length) throw new Error("empty lookup");
      blocks.push({
        type: "passage",
        reference: block.reference,
        normalizedReference: lookup.normalizedReference,
        verseStart: verses.length,
        verseCount: lookup.verses.length
      });
      verses.push(...lookup.verses);
    } catch {
      fallbacks.push(block.reference);
      blocks.push({ type: "text", content: block.reference });
    }
  }
  if (!blocks.length) return null;
  const source = blocks
    .map((block) => (block.type === "passage" ? block.reference : block.content))
    .join("\n");
  return { resolved: { blocks, verses, source }, fallbacks };
}

export function resolveSermonSlides(
  slides: SermonSlideInput[],
  resolve: (reference: string) => BibleLookupDTO
): SermonSlidesResolution {
  const resolved: SermonResolvedSlide[] = [];
  const fallbacks: string[] = [];
  for (const slide of slides) {
    const outcome = resolveSermonSlide(slide, resolve);
    if (!outcome) continue;
    resolved.push(outcome.resolved);
    fallbacks.push(...outcome.fallbacks);
  }
  return { resolved, fallbacks };
}

function buildSlideItem(id: string, slide: SermonResolvedSlide): SermonQueueItem {
  const passages = slide.blocks.filter((block): block is Extract<SermonSlideBlock, { type: "passage" }> => block.type === "passage");
  const reference = passages.map((passage) => passage.reference).join("；");
  return {
    id,
    kind: passages.length ? "bible" : "text",
    reference: reference || "文字分享",
    normalizedReference: passages.map((passage) => passage.normalizedReference).join("；") || "文字分享",
    verses: slide.verses,
    annotations: [],
    blocks: slide.blocks,
    source: slide.source,
    scrollLines: 0
  };
}

export function applyAdd(state: SermonStateDTO, slides: SermonResolvedSlide[], ctx: SermonMutationContext): SermonStateDTO {
  const capacity = SERMON_QUEUE_LIMIT - state.queue.length;
  if (capacity <= 0 || !slides.length) return state;
  const items: SermonQueueItem[] = slides.slice(0, capacity).map((slide) => buildSlideItem(ctx.createId(), slide));
  return touch({ ...state, queue: [...state.queue, ...items] }, ctx);
}

// 热编辑：按原文重编辑一屏，经文重查、文字保留；经文可能变化，标注与滚动位置重置，id 不变。
export function applyUpdate(state: SermonStateDTO, id: string, slide: SermonResolvedSlide, ctx: SermonMutationContext): SermonStateDTO {
  const item = state.queue.find((entry) => entry.id === id);
  if (!item) return state;
  return touch(replaceQueueItem(state, buildSlideItem(id, slide)), ctx);
}

// 屏内滚动同步（Shift+↑/↓ 一行步进）：行数夹到非负整数。
export function applyScroll(state: SermonStateDTO, id: string, lines: number, ctx: SermonMutationContext): SermonStateDTO {
  const item = state.queue.find((entry) => entry.id === id);
  if (!item) return state;
  const next = Math.max(0, Math.floor(lines));
  if (next === (item.scrollLines ?? 0)) return state;
  return touch(replaceQueueItem(state, { ...item, scrollLines: next }), ctx);
}

// 自由文字条目：不经过经文解析，正文为空的条目直接忽略；标题缺省时徽标显示“文字分享”。
export function applyAddTexts(state: SermonStateDTO, texts: SermonTextInput[], ctx: SermonMutationContext): SermonStateDTO {
  const capacity = SERMON_QUEUE_LIMIT - state.queue.length;
  const usable = texts.filter((entry) => entry.content.trim());
  if (capacity <= 0 || !usable.length) return state;
  const items: SermonQueueItem[] = usable.slice(0, capacity).map((entry) => {
    const title = entry.title?.trim() || undefined;
    return {
      id: ctx.createId(),
      kind: "text",
      reference: title || "文字分享",
      normalizedReference: title || "文字分享",
      verses: [],
      annotations: [],
      title,
      content: entry.content
    };
  });
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
  // 切换到该屏时屏内滚动归零（条目可能带上次展示遗留的 scrollLines）。
  const queue = state.queue.map((item) => (item.id === id && (item.scrollLines ?? 0) > 0 ? { ...item, scrollLines: 0 } : item));
  return touch({ ...state, queue, active: true, currentItemId: id }, ctx);
}

// 显示设置按字段合并：单字段非法只忽略该字段；字体倍率按 0.1 步进取整并夹在允许区间内，
// 边距取整后夹在 2–20；合并后与当前值相同视为无操作。
export function applyDisplay(state: SermonStateDTO, patch: Partial<SermonDisplayDTO>, ctx: SermonMutationContext): SermonStateDTO {
  const next = { ...state.display };
  let changed = false;
  if (patch.fontFamily !== undefined && (SERMON_FONT_FAMILIES as readonly string[]).includes(patch.fontFamily) && patch.fontFamily !== next.fontFamily) {
    next.fontFamily = patch.fontFamily;
    changed = true;
  }
  if (patch.fontScale !== undefined && Number.isFinite(patch.fontScale)) {
    const clamped = Math.min(SERMON_FONT_SCALE_MAX, Math.max(SERMON_FONT_SCALE_MIN, Math.round(patch.fontScale * 10) / 10));
    if (clamped !== next.fontScale) {
      next.fontScale = clamped;
      changed = true;
    }
  }
  if (patch.marginPct !== undefined && Number.isFinite(patch.marginPct)) {
    const clamped = Math.min(SERMON_MARGIN_PCT_MAX, Math.max(SERMON_MARGIN_PCT_MIN, Math.round(patch.marginPct)));
    if (clamped !== next.marginPct) {
      next.marginPct = clamped;
      changed = true;
    }
  }
  if (patch.background !== undefined && isValidSermonBackground(patch.background) && patch.background !== next.background) {
    next.background = patch.background;
    changed = true;
  }
  if (patch.textColor !== undefined && SERMON_TEXT_COLOR_HEX_RE.test(patch.textColor) && patch.textColor !== next.textColor) {
    next.textColor = patch.textColor;
    changed = true;
  }
  if (!changed) return state;
  return touch({ ...state, display: next }, ctx);
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

/** 载入已保存方案时替换整套队列与显示设置，并退出当前全屏展示。 */
export function applyLoadPlan(
  state: SermonStateDTO,
  plan: Pick<SermonStateDTO, "queue" | "display">,
  ctx: SermonMutationContext
): SermonStateDTO {
  return touch(
    {
      ...state,
      active: false,
      currentItemId: null,
      queue: plan.queue.map((item) => ({
        ...item,
        verses: item.verses.map((verse) => ({ ...verse })),
        annotations: item.annotations.map((annotation) => ({ ...annotation })),
        blocks: item.blocks?.map((block) => ({ ...block })),
        scrollLines: 0
      })),
      display: { ...plan.display }
    },
    ctx
  );
}

// 二期：演示范围在发起时确定并持久化；同时写入讲道者信息。
export function applySetScope(state: SermonStateDTO, scope: SermonPresentationScope, ctx: SermonMutationContext): SermonStateDTO {
  if (state.scope === scope) return touch(state, ctx);
  return touch({ ...state, scope }, ctx);
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

const slideBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("passage"),
    reference: z.string(),
    normalizedReference: z.string(),
    verseStart: z.number().int().min(0),
    verseCount: z.number().int().min(0)
  }),
  z.object({ type: z.literal("text"), content: z.string().max(4000) })
]);

const queueItemSchema = z
  .object({
    id: z.string().min(1),
    // 旧持久化数据没有 kind 字段，反序列化时按 bible 兼容。
    kind: z.enum(["bible", "text"]).default("bible"),
    reference: z.string(),
    normalizedReference: z.string(),
    verses: z.array(verseSchema),
    annotations: z.array(annotationSchema),
    title: z.string().max(100).optional(),
    content: z.string().max(4000).optional(),
    // 统一输入后的屏内有序内容；旧数据无此字段时按 verses/content 渲染。
    blocks: z.array(slideBlockSchema).optional(),
    source: z.string().max(8000).optional(),
    scrollLines: z.number().int().min(0).optional()
  })
  .superRefine((item, context) => {
    if (item.kind === "text" && !item.content?.trim() && !item.blocks?.some((block) => block.type === "text" && block.content.trim())) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "text item requires content" });
    }
    if (item.blocks) {
      for (const block of item.blocks) {
        if (block.type === "passage" && block.verseStart + block.verseCount > item.verses.length) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: "passage block exceeds verses" });
        }
      }
    }
  });

const displaySchema = z.object({
  // 历史持久化数据可能含已下架的 puhuiti/system，catch 到默认字体族，
  // 避免单个字段失效导致整个队列状态回退为空。
  fontFamily: z.enum(SERMON_FONT_FAMILIES).catch(DEFAULT_SERMON_DISPLAY.fontFamily),
  fontScale: z.number().min(SERMON_FONT_SCALE_MIN).max(SERMON_FONT_SCALE_MAX).default(DEFAULT_SERMON_DISPLAY.fontScale),
  marginPct: z.number().int().min(SERMON_MARGIN_PCT_MIN).max(SERMON_MARGIN_PCT_MAX).default(DEFAULT_SERMON_DISPLAY.marginPct),
  background: z.string().refine(isValidSermonBackground).default(DEFAULT_SERMON_DISPLAY.background),
  textColor: z.string().regex(SERMON_TEXT_COLOR_HEX_RE).default(DEFAULT_SERMON_TEXT_COLOR)
});

const stateSchema = z.object({
  active: z.boolean(),
  queue: z.array(queueItemSchema),
  currentItemId: z.string().nullable(),
  presenterId: z.string(),
  presenterName: z.string(),
  // 旧持久化数据（一期全局演示）没有 scope 字段，按集会迁移。
  scope: z.enum(["group", "assembly"]).catch("assembly"),
  display: displaySchema.optional(),
  // 旧持久化数据没有 display 字段、只有扁平 fontScale（更旧的数据连 fontScale 也没有），
  // 反序列化时迁移到 display，其余字段按默认值兼容。
  fontScale: z.number().min(SERMON_FONT_SCALE_MIN).max(SERMON_FONT_SCALE_MAX).optional(),
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
    const { fontScale: legacyFontScale, display, ...rest } = parsed.data;
    const state: SermonStateDTO = {
      ...rest,
      display: display ?? { ...DEFAULT_SERMON_DISPLAY, fontScale: legacyFontScale ?? DEFAULT_SERMON_DISPLAY.fontScale }
    };
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
    add: (actor: SermonActor, slides: SermonResolvedSlide[]) => mutate(actor, (current, ctx) => applyAdd(current, slides, ctx)),
    addTexts: (actor: SermonActor, texts: SermonTextInput[]) => mutate(actor, (current, ctx) => applyAddTexts(current, texts, ctx)),
    update: (actor: SermonActor, id: string, slide: SermonResolvedSlide) => mutate(actor, (current, ctx) => applyUpdate(current, id, slide, ctx)),
    scroll: (actor: SermonActor, id: string, lines: number) => mutate(actor, (current, ctx) => applyScroll(current, id, lines, ctx)),
    reorder: (actor: SermonActor, order: string[]) => mutate(actor, (current, ctx) => applyReorder(current, order, ctx)),
    remove: (actor: SermonActor, id: string) => mutate(actor, (current, ctx) => applyRemove(current, id, ctx)),
    present: (actor: SermonActor, id: string | null) => mutate(actor, (current, ctx) => applyPresent(current, id, ctx)),
    display: (actor: SermonActor, patch: Partial<SermonDisplayDTO>) => mutate(actor, (current, ctx) => applyDisplay(current, patch, ctx)),
    annotate: (actor: SermonActor, itemId: string, annotation: SermonAnnotation) =>
      mutate(actor, (current, ctx) => applyAnnotate(current, itemId, annotation, ctx)),
    annotateClear: (actor: SermonActor, itemId: string, filter: SermonAnnotationClearFilter) =>
      mutate(actor, (current, ctx) => applyAnnotateClear(current, itemId, filter, ctx)),
    clear: (actor: SermonActor) => mutate(actor, (current, ctx) => applyClear(current, ctx)),
    loadPlan: (actor: SermonActor, plan: Pick<SermonStateDTO, "queue" | "display">) =>
      mutate(actor, (current, ctx) => applyLoadPlan(current, plan, ctx)),
    setScope: (actor: SermonActor, scope: SermonPresentationScope) => mutate(actor, (current, ctx) => applySetScope(current, scope, ctx))
  };
}

export type SermonStateStore = ReturnType<typeof createSermonStateStore>;
