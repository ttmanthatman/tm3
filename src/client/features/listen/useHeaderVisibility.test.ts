import assert from "node:assert/strict";
import test from "node:test";
import { createRenderer, type Ref } from "vue";
import { useHeaderVisibility } from "./useHeaderVisibility.js";

interface HostNode { children: HostNode[] }
const node = (): HostNode => ({ children: [] });
const renderer = createRenderer<HostNode, HostNode>({
  createElement: node, createText: node, createComment: node,
  setText() {}, setElementText() {}, patchProp() {},
  parentNode: () => null, nextSibling: () => null,
  insert: (child, parent) => { parent.children.push(child); }, remove() {}
});

test("header animations pause on hidden/pagehide, resume on pageshow and release listeners on unmount", () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const documentEvents = new EventTarget();
  const windowEvents = new EventTarget();
  let state = "visible";
  Object.defineProperty(documentEvents, "visibilityState", { get: () => state });
  Object.defineProperty(globalThis, "document", { configurable: true, value: documentEvents });
  Object.defineProperty(globalThis, "window", { configurable: true, value: windowEvents });
  let visible!: Ref<boolean>;
  const app = renderer.createApp({ setup() { visible = useHeaderVisibility(); return () => null; } });
  try {
    app.mount(node());
    assert.equal(visible.value, true);
    state = "hidden";
    documentEvents.dispatchEvent(new Event("visibilitychange"));
    assert.equal(visible.value, false);
    state = "visible";
    documentEvents.dispatchEvent(new Event("visibilitychange"));
    assert.equal(visible.value, true);
    windowEvents.dispatchEvent(new Event("pagehide"));
    assert.equal(visible.value, false);
    windowEvents.dispatchEvent(new Event("pageshow"));
    assert.equal(visible.value, true);
    app.unmount();
    assert.equal(visible.value, false);
    windowEvents.dispatchEvent(new Event("pageshow"));
    documentEvents.dispatchEvent(new Event("visibilitychange"));
    assert.equal(visible.value, false);
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
