import assert from "node:assert/strict";
import test from "node:test";
import { effectScope, nextTick, ref } from "vue";
import { bibleSplitBounds, clampBibleSplitRatio, useBibleDisplayLayout } from "./useBibleDisplayLayout";

test("split widths respect both panels and only snap to reachable stops", () => {
  const { min, max } = bibleSplitBounds(768);
  assert.equal(min * 756, 320);
  assert.equal((1 - max) * 756, 360);
  assert.equal(clampBibleSplitRatio(0.25, 768, true), min);
  assert.equal(clampBibleSplitRatio(0.75, 768, true), max);
  for (const stop of [0.25, 0.5, 0.75]) {
    assert.equal(clampBibleSplitRatio(stop + 0.005, 1600, true), stop);
  }
  assert.equal(clampBibleSplitRatio(0.6, 1600, true), 0.6);
});

test("login initializes split, resize/fullscreen/reopen preserve preference, logout resets and disposes listeners", async () => {
  const events = new EventTarget();
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  const mock = Object.assign(events, { innerWidth: 1600, screen: { width: 1600, height: 1000 }, matchMedia: () => ({ matches: false }) });
  Object.defineProperty(globalThis, "window", { configurable: true, value: mock });
  const scope = effectScope();
  try {
    const accountId = ref<number>();
    const layout = scope.run(() => useBibleDisplayLayout(() => accountId.value))!;
    assert.equal(layout.bibleOpen.value, false);
    accountId.value = 1;
    await nextTick();
    assert.equal(layout.bibleSplit.value, true);
    assert.equal(layout.bibleSplitRatio.value, 0.5);
    layout.resizeBible(0.75);
    layout.expandBible();
    assert.equal(layout.bibleFullscreen.value, true);
    layout.shrinkBible();
    assert.equal(layout.bibleSplitRatio.value, 0.75);
    mock.innerWidth = 768;
    mock.dispatchEvent(new Event("resize"));
    assert.ok(layout.bibleSplitRatio.value < 0.6);
    mock.innerWidth = 390;
    mock.dispatchEvent(new Event("resize"));
    assert.equal(layout.bibleFullscreen.value, true);
    mock.innerWidth = 1600;
    mock.dispatchEvent(new Event("resize"));
    assert.equal(layout.bibleSplit.value, true);
    assert.equal(layout.bibleSplitRatio.value, 0.75);
    layout.bibleOpen.value = false;
    layout.openBible();
    assert.equal(layout.bibleSplitRatio.value, 0.75);
    accountId.value = undefined;
    await nextTick();
    assert.equal(layout.bibleOpen.value, false);
    assert.equal(layout.bibleSplitRatio.value, 0.5);
    scope.stop();
    mock.innerWidth = 800;
    mock.dispatchEvent(new Event("resize"));
    assert.equal(layout.viewportWidth.value, 1600);
  } finally {
    scope.stop();
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("a landscape touch phone never initializes or opens split view", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  const mock = Object.assign(new EventTarget(), { innerWidth: 844, screen: { width: 390, height: 844 }, matchMedia: () => ({ matches: true }) });
  Object.defineProperty(globalThis, "window", { configurable: true, value: mock });
  const scope = effectScope();
  try {
    const layout = scope.run(() => useBibleDisplayLayout(() => 1))!;
    assert.equal(layout.bibleOpen.value, false);
    layout.openBible();
    assert.equal(layout.bibleSplit.value, false);
    assert.equal(layout.bibleFullscreen.value, true);
  } finally {
    scope.stop();
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
