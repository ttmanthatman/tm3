import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_BIBLE_PANES,
  biblePaneLabel,
  equalBiblePaneSizes,
  resolveBibleLinkTargetPaneId,
  resizeBiblePanePair
} from "./bibleSplitLayout";

test("Bible split layout supports four labeled panes", () => {
  assert.equal(MAX_BIBLE_PANES, 4);
  assert.deepEqual(Array.from({ length: MAX_BIBLE_PANES }, (_, index) => biblePaneLabel(index)), ["A", "B", "C", "D"]);
  assert.deepEqual(equalBiblePaneSizes(4), [25, 25, 25, 25]);
});

test("an explicit receiving pane overrides cyclic cross-opening", () => {
  const paneIds = ["pane-a", "pane-b", "pane-c", "pane-d"];
  assert.equal(resolveBibleLinkTargetPaneId(paneIds, "pane-a", "pane-d"), "pane-d");
  assert.equal(resolveBibleLinkTargetPaneId(paneIds, "pane-d", "pane-d"), "pane-d");
});

test("links cross-open in two panes and cycle across larger layouts", () => {
  assert.equal(resolveBibleLinkTargetPaneId(["a"], "a", null), "a");
  assert.equal(resolveBibleLinkTargetPaneId(["a", "b"], "a", null), "b");
  assert.equal(resolveBibleLinkTargetPaneId(["a", "b"], "b", null), "a");
  assert.equal(resolveBibleLinkTargetPaneId(["a", "b", "c", "d"], "c", null), "d");
  assert.equal(resolveBibleLinkTargetPaneId(["a", "b", "c", "d"], "d", null), "a");
});

test("dragging a separator only resizes its adjacent panes", () => {
  assert.deepEqual(resizeBiblePanePair([25, 25, 25, 25], 1, 10), [25, 32, 18, 25]);
  assert.deepEqual(resizeBiblePanePair([50, 50], 0, 80), [82, 18]);
  assert.deepEqual(resizeBiblePanePair([50, 50], 0, -80), [18, 82]);
});
