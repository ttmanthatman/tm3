import assert from "node:assert/strict";
import test from "node:test";
import { cleanBibleWorkspaceState } from "./workspaceState.js";

const matthew = { code: "MAT", name: "马太福音", chapterCount: 28 };

function validSnapshot() {
  return {
    version: 2 as const,
    view: "reader" as const,
    panes: [
      {
        id: "pane-1",
        book: matthew,
        visibleChapter: 3,
        targetVerse: { chapter: 3, verse: 13, endVerse: 17, matches: [] },
        scrollAnchor: { chapter: 3, verse: 13, offset: 42 },
        backStack: [{ book: matthew, visibleChapter: 1, targetVerse: null, scrollAnchor: null }]
      }
    ],
    activePaneId: "pane-1",
    receivingPaneId: "pane-1",
    orientation: "columns" as const,
    paneSizes: [100],
    updatedAt: "2026-09-02T10:00:00.000Z"
  };
}

test("cleanBibleWorkspaceState accepts a valid snapshot", () => {
  const cleaned = cleanBibleWorkspaceState(validSnapshot());
  assert.equal(cleaned?.panes.length, 1);
  assert.equal(cleaned?.panes[0]?.book.code, "MAT");
  assert.equal(cleaned?.receivingPaneId, "pane-1");
  assert.equal(cleaned?.updatedAt, "2026-09-02T10:00:00.000Z");
});

test("cleanBibleWorkspaceState rejects malformed input", () => {
  assert.equal(cleanBibleWorkspaceState(null), null);
  assert.equal(cleanBibleWorkspaceState("reader"), null);
  assert.equal(cleanBibleWorkspaceState({ version: 1 }), null);
  assert.equal(cleanBibleWorkspaceState({ ...validSnapshot(), updatedAt: "" }), null);
  // 空窗格是合法的“未打开任何经卷”状态，降级为目录页
  const empty = cleanBibleWorkspaceState({ ...validSnapshot(), panes: [], activePaneId: null, receivingPaneId: null });
  assert.equal(empty?.view, "home");
  assert.equal(empty?.panes.length, 0);
});

test("cleanBibleWorkspaceState caps pane and back-stack counts", () => {
  const snapshot = validSnapshot();
  const panes = Array.from({ length: 6 }, (_, index) => ({ ...snapshot.panes[0], id: `pane-${index}` }));
  const cleaned = cleanBibleWorkspaceState({ ...snapshot, panes, paneSizes: panes.map(() => 16) });
  assert.equal(cleaned, null);
  const overStack = [{ ...snapshot.panes[0], backStack: Array.from({ length: 25 }, () => ({ book: matthew, visibleChapter: 1, targetVerse: null, scrollAnchor: null })) }];
  assert.equal(cleanBibleWorkspaceState({ ...snapshot, panes: overStack }), null);
});

test("cleanBibleWorkspaceState drops duplicate ids and out-of-range chapters", () => {
  const snapshot = validSnapshot();
  const panes = [
    snapshot.panes[0],
    { ...snapshot.panes[0], id: "pane-1" },
    { ...snapshot.panes[0], id: "pane-2", visibleChapter: 29 },
    { ...snapshot.panes[0], id: "pane-3", visibleChapter: 5 }
  ];
  const cleaned = cleanBibleWorkspaceState({ ...snapshot, panes, activePaneId: "pane-2", receivingPaneId: "pane-2", paneSizes: [50, 50] });
  assert.deepEqual(cleaned?.panes.map((pane) => pane.id), ["pane-1", "pane-3"]);
  assert.equal(cleaned?.activePaneId, "pane-1");
  assert.equal(cleaned?.receivingPaneId, null);
  assert.deepEqual(cleaned?.paneSizes, [50, 50]);
});

test("cleanBibleWorkspaceState downgrades a reader view without panes to home", () => {
  const snapshot = validSnapshot();
  const cleaned = cleanBibleWorkspaceState({ ...snapshot, panes: [{ ...snapshot.panes[0], visibleChapter: 99 }], activePaneId: null, receivingPaneId: null });
  assert.equal(cleaned?.view, "home");
  assert.equal(cleaned?.panes.length, 0);
});
