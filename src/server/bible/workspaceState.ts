import { z } from "zod";
import type { BibleWorkspaceSnapshotDTO } from "../../shared/types.js";

// 账号级阅读窗格快照的服务端清洗：结构严格校验 + 数量/长度限幅，
// 防止偏好 JSON 被异常膨胀或注入非法章节。
const matchRangeSchema = z.object({
  start: z.number().int().min(0).max(100000),
  end: z.number().int().min(0).max(100000)
});

const targetSchema = z.object({
  chapter: z.number().int().min(1).max(150),
  verse: z.number().int().min(1).max(200),
  endVerse: z.number().int().min(1).max(200),
  matches: z.array(matchRangeSchema).max(50)
});

const scrollAnchorSchema = z.object({
  chapter: z.number().int().min(1).max(150),
  verse: z.number().int().min(1).max(200).nullable(),
  offset: z.number().min(-100000).max(100000)
});

const bookSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(40),
  chapterCount: z.number().int().min(1).max(150)
});

const locationSchema = z.object({
  book: bookSchema,
  visibleChapter: z.number().int().min(1).max(150),
  targetVerse: targetSchema.nullable(),
  scrollAnchor: scrollAnchorSchema.nullable()
});

const paneSchema = locationSchema.extend({
  id: z.string().trim().min(1).max(40),
  backStack: z.array(locationSchema).max(20)
});

const snapshotSchema = z.object({
  version: z.literal(2),
  view: z.enum(["home", "chapters", "reader"]),
  panes: z.array(paneSchema).max(4),
  activePaneId: z.string().max(40).nullable(),
  receivingPaneId: z.string().max(40).nullable(),
  orientation: z.enum(["columns", "rows"]).nullable(),
  paneSizes: z.array(z.number().min(1).max(100)).max(4),
  updatedAt: z.string().min(1).max(40)
});

export function cleanBibleWorkspaceState(input: unknown): BibleWorkspaceSnapshotDTO | null {
  const parsed = snapshotSchema.safeParse(input);
  if (!parsed.success) return null;
  const snapshot = parsed.data;
  const ids = new Set<string>();
  const panes = snapshot.panes.filter((pane) => {
    if (ids.has(pane.id)) return false;
    if (pane.visibleChapter > pane.book.chapterCount) return false;
    ids.add(pane.id);
    return true;
  });
  const paneCount = Math.max(1, panes.length);
  return {
    ...snapshot,
    view: snapshot.view === "reader" && !panes.length ? "home" : snapshot.view,
    panes,
    activePaneId: snapshot.activePaneId && ids.has(snapshot.activePaneId) ? snapshot.activePaneId : panes[0]?.id || null,
    receivingPaneId: snapshot.receivingPaneId && ids.has(snapshot.receivingPaneId) ? snapshot.receivingPaneId : null,
    paneSizes: snapshot.paneSizes.length === paneCount ? snapshot.paneSizes : Array.from({ length: paneCount }, () => 100 / paneCount)
  };
}
