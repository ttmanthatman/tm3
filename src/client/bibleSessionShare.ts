import type { BibleSessionPaneDTO, BibleSessionPayloadDTO } from "@shared/types";
import type { BiblePaneState } from "./bibleWorkspaceState";
import type { BibleSplitOrientation } from "./bibleSplitLayout";

/** 从当前窗格状态构建“打开的圣经”分享载荷；translation 以服务端目录为准，仅作展示回退 */
export function buildBibleSessionSharePayload(
  panes: BiblePaneState[],
  orientation: BibleSplitOrientation | null,
  receivingPaneId: string | null,
  translation: string
): BibleSessionPayloadDTO | null {
  if (!panes.length) return null;
  const receivingIndex = receivingPaneId ? panes.findIndex((pane) => pane.id === receivingPaneId) : -1;
  return {
    kind: "bible_session",
    translation,
    orientation,
    receivingIndex: receivingIndex >= 0 ? receivingIndex : null,
    panes: panes.map((pane) => {
      const target = pane.targetVerse && pane.targetVerse.chapter === pane.visibleChapter ? pane.targetVerse : null;
      return {
        bookCode: pane.book.code,
        bookName: pane.book.name,
        chapter: pane.visibleChapter,
        verseStart: target?.verse ?? null,
        verseEnd: target?.endVerse ?? null
      };
    })
  };
}

/** 解析消息里的“打开的圣经”载荷；结构非法时返回 null */
export function parseBibleSessionPayload(input: unknown): BibleSessionPayloadDTO | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  if (raw.kind !== "bible_session" || !Array.isArray(raw.panes)) return null;
  const panes: BibleSessionPaneDTO[] = [];
  for (const entry of raw.panes.slice(0, 4)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const pane = entry as Record<string, unknown>;
    if (typeof pane.bookCode !== "string" || !pane.bookCode || typeof pane.bookName !== "string" || !pane.bookName) return null;
    const chapter = Number(pane.chapter);
    if (!Number.isInteger(chapter) || chapter < 1) return null;
    const verseStart = pane.verseStart === null || pane.verseStart === undefined ? null : Number(pane.verseStart);
    const verseEnd = pane.verseEnd === null || pane.verseEnd === undefined ? null : Number(pane.verseEnd);
    if (verseStart !== null && (!Number.isInteger(verseStart) || verseStart < 1)) return null;
    if (verseEnd !== null && (!Number.isInteger(verseEnd) || verseEnd < 1)) return null;
    panes.push({ bookCode: pane.bookCode, bookName: pane.bookName, chapter, verseStart, verseEnd });
  }
  if (!panes.length) return null;
  const receivingIndex = Number(raw.receivingIndex);
  return {
    kind: "bible_session",
    translation: typeof raw.translation === "string" ? raw.translation : "",
    orientation: raw.orientation === "columns" || raw.orientation === "rows" ? raw.orientation : null,
    receivingIndex: Number.isInteger(receivingIndex) && receivingIndex >= 0 && receivingIndex < panes.length ? receivingIndex : null,
    panes,
    ...(typeof raw.description === "string" && raw.description.trim() ? { description: raw.description.trim().slice(0, 200) } : {})
  };
}

/** 单个窗格的展示标签：马太福音 3章 或 马太福音 3:13-17 */
export function bibleSessionPaneLabel(pane: BibleSessionPaneDTO) {
  if (pane.verseStart) return `${pane.bookName} ${pane.chapter}:${pane.verseStart}${pane.verseEnd && pane.verseEnd !== pane.verseStart ? `-${pane.verseEnd}` : ""}`;
  return `${pane.bookName} ${pane.chapter}章`;
}
