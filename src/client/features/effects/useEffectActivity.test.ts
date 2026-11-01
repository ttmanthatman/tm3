import assert from "node:assert/strict";
import test from "node:test";
import { effectScope, ref } from "vue";
import { useEffectActivity } from "./useEffectActivity";

test("effects pause for occlusion, visibility, reduced motion and page exit, then dispose all listeners", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const media = Object.assign(new EventTarget(), { matches: false });
  const fakeWindow = Object.assign(new EventTarget(), { matchMedia: () => media });
  const fakeDocument = Object.assign(new EventTarget(), { hidden: false });
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: fakeDocument });
  const scope = effectScope();
  try {
    const enabled = ref(true);
    const changes: boolean[] = [];
    const { active } = scope.run(() => useEffectActivity({ enabled: () => enabled.value, onChange: (value) => changes.push(value) }))!;
    assert.equal(active.value, true);
    enabled.value = false;
    assert.equal(active.value, false);
    enabled.value = true;
    assert.equal(active.value, true);
    media.matches = true; media.dispatchEvent(new Event("change"));
    assert.equal(active.value, false);
    enabled.value = false;
    media.matches = false; media.dispatchEvent(new Event("change"));
    assert.equal(active.value, false, "removing one blocker must not resume a covered view");
    enabled.value = true;
    assert.equal(active.value, true);
    fakeDocument.hidden = true; fakeDocument.dispatchEvent(new Event("visibilitychange"));
    assert.equal(active.value, false);
    fakeDocument.hidden = false; fakeDocument.dispatchEvent(new Event("visibilitychange"));
    assert.equal(active.value, true);
    fakeWindow.dispatchEvent(new Event("pagehide"));
    assert.equal(active.value, false);
    fakeWindow.dispatchEvent(new Event("pageshow"));
    assert.equal(active.value, true);
    scope.stop();
    const count = changes.length;
    fakeWindow.dispatchEvent(new Event("pagehide"));
    media.matches = true; media.dispatchEvent(new Event("change"));
    fakeDocument.hidden = true; fakeDocument.dispatchEvent(new Event("visibilitychange"));
    enabled.value = false;
    assert.equal(changes.length, count);
    assert.equal(changes.at(-1), false);
  } finally {
    scope.stop();
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else Reflect.deleteProperty(globalThis, "window");
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument); else Reflect.deleteProperty(globalThis, "document");
  }
});
