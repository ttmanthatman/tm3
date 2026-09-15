import assert from "node:assert/strict";
import test from "node:test";
import { createModalStack, type ModalStackEntry } from "./modalStack";

class FakeElement {
  parent: FakeElement | null = null;
  children: FakeElement[] = [];
  attributes = new Map<string, string>();
  isConnected = true;
  visible = true;
  focusCalls = 0;
  doc: FakeDocument;

  constructor(doc: FakeDocument, options: { focusable?: boolean; disabled?: boolean } = {}) {
    this.doc = doc;
    if (options.focusable) this.attributes.set("tabindex", "0");
    if (options.disabled) this.attributes.set("disabled", "");
    doc.track(this);
  }

  append(child: FakeElement) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  focus() {
    this.focusCalls += 1;
    this.doc.activeElement = this;
  }

  contains(other: unknown) {
    let current = other as FakeElement | null;
    while (current) {
      if (current === this) return true;
      current = current.parent;
    }
    return false;
  }

  querySelectorAll() {
    const matches: FakeElement[] = [];
    const walk = (node: FakeElement) => {
      for (const child of node.children) {
        if (child.attributes.has("tabindex")) matches.push(child);
        walk(child);
      }
    };
    walk(this);
    return matches;
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  hasAttribute(name: string) {
    return this.attributes.has(name);
  }

  getClientRects() {
    return this.visible ? [{}] : [];
  }
}

interface DispatchedKeyEvent {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  defaultPrevented: boolean;
  propagationStopped: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

class FakeDocument {
  activeElement: FakeElement | null = null;
  body: FakeElement;
  private tabOrder: FakeElement[] = [];
  private listeners = new Set<(event: DispatchedKeyEvent) => void>();

  track(element: FakeElement) {
    if (!this.tabOrder.includes(element)) this.tabOrder.push(element);
  }

  constructor() {
    this.body = new FakeElement(this);
    this.activeElement = this.body;
  }

  addEventListener(_type: string, listener: (event: DispatchedKeyEvent) => void) {
    this.listeners.add(listener);
  }

  removeEventListener(_type: string, listener: (event: DispatchedKeyEvent) => void) {
    this.listeners.delete(listener);
  }

  get listenerCount() {
    return this.listeners.size;
  }

  dispatchKey(key: string, options: { shiftKey?: boolean; isComposing?: boolean } = {}) {
    const event: DispatchedKeyEvent = {
      key,
      shiftKey: options.shiftKey ?? false,
      isComposing: options.isComposing ?? false,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this.propagationStopped = true;
      }
    };
    for (const listener of [...this.listeners]) listener(event);
    if (key === "Tab" && !event.defaultPrevented) {
      const focusables = this.tabOrder.filter(
        (el) => el.attributes.has("tabindex") && el.attributes.get("tabindex") !== "-1" && !el.attributes.has("disabled")
      );
      const index = this.activeElement ? focusables.indexOf(this.activeElement) : -1;
      const step = event.shiftKey ? -1 : 1;
      const next = focusables[(index + step + focusables.length) % focusables.length];
      if (next) next.focus();
    }
    return event;
  }
}

function setup() {
  const doc = new FakeDocument();
  const stack = createModalStack(doc as unknown as Document);
  return { doc, stack };
}

function makeEntry(doc: FakeDocument, options: { canClose?: boolean; focusableCount?: number } = {}) {
  const root = new FakeElement(doc);
  const focusables: FakeElement[] = [];
  for (let i = 0; i < (options.focusableCount ?? 0); i += 1) {
    focusables.push(root.append(new FakeElement(doc, { focusable: true })));
  }
  const calls = { close: 0 };
  const entry: ModalStackEntry = {
    root: () => root as unknown as HTMLElement,
    canClose: () => options.canClose ?? true,
    requestClose: () => {
      calls.close += 1;
    }
  };
  return { root, focusables, calls, entry };
}

test("escape closes only the top-most modal and consumes the event", () => {
  const { doc, stack } = setup();
  const lower = makeEntry(doc, { focusableCount: 1 });
  const upper = makeEntry(doc, { focusableCount: 1 });
  stack.register(lower.entry);
  stack.register(upper.entry);

  const event = doc.dispatchKey("Escape");
  assert.equal(upper.calls.close, 1);
  assert.equal(lower.calls.close, 0);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
});

test("escape during IME composition does not close the modal", () => {
  const { doc, stack } = setup();
  const modal = makeEntry(doc, { focusableCount: 1 });
  stack.register(modal.entry);

  const event = doc.dispatchKey("Escape", { isComposing: true });
  assert.equal(modal.calls.close, 0);
  assert.equal(event.propagationStopped, false);
});

test("a busy modal leaves escape untouched", () => {
  const { doc, stack } = setup();
  const modal = makeEntry(doc, { canClose: false, focusableCount: 1 });
  stack.register(modal.entry);

  const event = doc.dispatchKey("Escape");
  assert.equal(modal.calls.close, 0);
  assert.equal(event.defaultPrevented, false);
  assert.equal(event.propagationStopped, false);
});

test("opening focuses the first focusable child, otherwise the container with tabindex -1", () => {
  const { doc, stack } = setup();
  const withChildren = makeEntry(doc, { focusableCount: 2 });
  stack.register(withChildren.entry);
  assert.equal(doc.activeElement, withChildren.focusables[0]);
  assert.equal(withChildren.focusables[0].focusCalls, 1);

  const empty = makeEntry(doc, { focusableCount: 0 });
  stack.register(empty.entry);
  assert.equal(doc.activeElement, empty.root);
  assert.equal(empty.root.getAttribute("tabindex"), "-1");
});

test("tab and shift+tab cycle within the top-most modal", () => {
  const { doc, stack } = setup();
  const modal = makeEntry(doc, { focusableCount: 3 });
  stack.register(modal.entry);
  const [first, second, third] = modal.focusables;
  assert.equal(doc.activeElement, first);

  doc.dispatchKey("Tab");
  assert.equal(doc.activeElement, second);
  doc.dispatchKey("Tab");
  assert.equal(doc.activeElement, third);
  const wrappedForward = doc.dispatchKey("Tab");
  assert.equal(doc.activeElement, first);
  assert.equal(wrappedForward.defaultPrevented, true);

  const wrappedBackward = doc.dispatchKey("Tab", { shiftKey: true });
  assert.equal(doc.activeElement, third);
  assert.equal(wrappedBackward.defaultPrevented, true);

  // Focus outside the modal is pulled back inside on the next Tab.
  const outside = new FakeElement(doc, { focusable: true });
  outside.focus();
  doc.dispatchKey("Tab");
  assert.equal(doc.activeElement, first);
  outside.focus();
  doc.dispatchKey("Tab", { shiftKey: true });
  assert.equal(doc.activeElement, third);
});

test("tab on a modal without focusable children keeps focus on the container", () => {
  const { doc, stack } = setup();
  const modal = makeEntry(doc, { focusableCount: 0 });
  stack.register(modal.entry);
  const event = doc.dispatchKey("Tab");
  assert.equal(event.defaultPrevented, true);
  assert.equal(doc.activeElement, modal.root);
});

test("tab applies only to the top-most modal while two are open", () => {
  const { doc, stack } = setup();
  const lower = makeEntry(doc, { focusableCount: 1 });
  const upper = makeEntry(doc, { focusableCount: 2 });
  stack.register(lower.entry);
  stack.register(upper.entry);

  doc.dispatchKey("Tab");
  assert.equal(doc.activeElement, upper.focusables[1]);
  doc.dispatchKey("Tab");
  assert.equal(doc.activeElement, upper.focusables[0]);
  assert.notEqual(doc.activeElement, lower.focusables[0]);
});

test("closing returns focus to the trigger element, or to the remaining modal", () => {
  const { doc, stack } = setup();
  const trigger = new FakeElement(doc, { focusable: true });
  trigger.focus();

  const lower = makeEntry(doc, { focusableCount: 1 });
  const lowerRegistration = stack.register(lower.entry);
  const upper = makeEntry(doc, { focusableCount: 1 });
  const upperRegistration = stack.register(upper.entry);

  upperRegistration.release();
  // upper's trigger was the focused element inside lower, so focus returns there.
  assert.equal(doc.activeElement, lower.focusables[0]);

  lowerRegistration.release();
  assert.equal(doc.activeElement, trigger);
});

test("closing falls back to the remaining modal when the trigger element is gone", () => {
  const { doc, stack } = setup();
  const a = makeEntry(doc, { focusableCount: 1 });
  stack.register(a.entry);
  const b = makeEntry(doc, { focusableCount: 1 });
  const bRegistration = stack.register(b.entry);
  const c = makeEntry(doc, { focusableCount: 1 });
  const cRegistration = stack.register(c.entry);

  // B unmounts while C is still open; C's restore target lived inside B.
  bRegistration.release();
  b.root.isConnected = false;
  b.focusables[0].isConnected = false;

  cRegistration.release();
  assert.equal(doc.activeElement, a.focusables[0]);
});

test("closing the last modal with a disconnected trigger leaves focus untouched", () => {
  const { doc, stack } = setup();
  const gone = new FakeElement(doc, { focusable: true });
  gone.focus();
  const modal = makeEntry(doc, { focusableCount: 1 });
  const registration = stack.register(modal.entry);
  gone.isConnected = false;
  registration.release();
  assert.equal(doc.activeElement, modal.focusables[0]);
  assert.equal(doc.listenerCount, 0);
});

test("releasing a lower entry while another is on top does not move focus", () => {
  const { doc, stack } = setup();
  const lower = makeEntry(doc, { focusableCount: 1 });
  const lowerRegistration = stack.register(lower.entry);
  const upper = makeEntry(doc, { focusableCount: 1 });
  stack.register(upper.entry);
  const focused = doc.activeElement;

  lowerRegistration.release();
  assert.equal(doc.activeElement, focused);
  assert.equal(stack.size(), 1);
});

test("twenty open/close cycles leave no keydown listener behind", () => {
  const { doc, stack } = setup();
  assert.equal(doc.listenerCount, 0);
  for (let i = 0; i < 20; i += 1) {
    const modal = makeEntry(doc, { focusableCount: 1 });
    const registration = stack.register(modal.entry);
    assert.equal(doc.listenerCount, 1);
    doc.dispatchKey("Escape");
    assert.equal(modal.calls.close, 1);
    registration.release();
  }
  assert.equal(doc.listenerCount, 0);
  assert.equal(stack.size(), 0);
});

test("release is idempotent", () => {
  const { doc, stack } = setup();
  const modal = makeEntry(doc, { focusableCount: 1 });
  const registration = stack.register(modal.entry);
  registration.release();
  registration.release();
  assert.equal(stack.size(), 0);
  assert.equal(doc.listenerCount, 0);
});
