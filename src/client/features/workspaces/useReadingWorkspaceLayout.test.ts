import assert from "node:assert/strict";
import test from "node:test";
import { effectScope, nextTick, ref } from "vue";
import { readingPanelRects, useReadingWorkspaceLayout } from "./useReadingWorkspaceLayout";

test("four panels tile the viewport without gaps and three panels fill the released area", () => {
  const panels = ["bible", "study", "book", "chat"] as const;
  for (const arrangement of ["grid", "columns", "rows"] as const) {
    const rects = readingPanelRects([...panels], arrangement, 1280, 862, .45, .6);
    assert.equal(Object.values(rects).reduce((sum, rect) => sum + rect.width * rect.height, 0), 1280 * 862);
    for (const rect of Object.values(rects)) {
      assert.ok(rect.left >= 0 && rect.top >= 0 && rect.left + rect.width <= 1280.01 && rect.top + rect.height <= 862.01);
    }
  }
  const rects = readingPanelRects(["bible", "study", "chat"], "grid", 1280, 862, .5, .5);
  assert.equal(rects.bible?.height, 862);
  assert.equal(rects.study!.left + rects.study!.width, rects.chat!.left);
  assert.equal(rects.study!.height, 862);
});

test("account scoped layouts restore open panels and sizing without restoring temporary fullscreen", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: Object.assign(new EventTarget(), { innerHeight: 900 }) });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } });
  let scope = effectScope();
  const account = ref<number | undefined>(1);
  const create = () => scope.run(() => useReadingWorkspaceLayout({ accountId: () => account.value,
    bibleOpen: ref(true), bookOpen: ref(false), studyOpen: ref(false), splitAvailable: ref(true), viewportWidth: ref(1280) }))!;
  try {
    let layout = create();
    layout.studyOpen.value = true;
    layout.chatOpen.value = false;
    layout.arrangement.value = "rows";
    layout.resize("row", .65);
    layout.toggleFullscreen("study");
    await nextTick();
    scope.stop(); scope = effectScope();
    layout = create();
    assert.equal(layout.studyOpen.value, true);
    assert.equal(layout.chatOpen.value, false);
    assert.equal(layout.arrangement.value, "rows");
    assert.equal(layout.rowRatio.value, .65);
    assert.equal(layout.fullscreen.value, null);
    account.value = 2; await nextTick();
    assert.equal(layout.studyOpen.value, false);
    assert.equal(layout.chatOpen.value, true);
    assert.equal(layout.arrangement.value, "grid");
    layout.close("bible"); layout.close("chat");
    assert.equal(layout.chatOpen.value, true);
  } finally {
    scope.stop();
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else Reflect.deleteProperty(globalThis, "window");
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage); else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
