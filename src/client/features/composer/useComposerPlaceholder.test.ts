import assert from "node:assert/strict";
import test from "node:test";
import { useComposerPlaceholder } from "./useComposerPlaceholder.js";

type PendingTimer = { fn: () => void; delay: number };

function installDomStubs() {
  let pending: PendingTimer | null = null;
  const listeners = new Map<string, Set<() => void>>();
  const globals = globalThis as Record<string, unknown>;
  const originalWindow = globals.window;
  const originalDocument = globals.document;
  globals.window = {
    setTimeout: (fn: () => void, ms: number) => {
      pending = { fn, delay: ms };
      return 1;
    },
    clearTimeout: () => {
      pending = null;
    }
  };
  globals.document = {
    hidden: false,
    addEventListener: (name: string, fn: () => void) => {
      const set = listeners.get(name) ?? new Set<() => void>();
      set.add(fn);
      listeners.set(name, set);
    },
    removeEventListener: (name: string, fn: () => void) => {
      listeners.get(name)?.delete(fn);
    }
  };
  return {
    fire() {
      const timer = pending;
      pending = null;
      assert.ok(timer, "expected a scheduled timer");
      timer.fn();
    },
    pendingDelay: () => pending?.delay ?? null,
    hasPending: () => pending !== null,
    listenerCount: (name: string) => listeners.get(name)?.size ?? 0,
    restore() {
      globals.window = originalWindow;
      globals.document = originalDocument;
    }
  };
}

function createHarness(prompts: string[] = ["第一条", "第二条"]) {
  const dom = installDomStubs();
  const placeholder = useComposerPlaceholder({
    getPrompts: () => prompts,
    getHoldSeconds: () => 3,
    getAppearSeconds: () => 1,
    getDisappearSeconds: () => 2,
    getGapSeconds: () => 6
  });
  return { dom, placeholder };
}

test("rotates prompts through appear, hold, disappear, and gap phases", () => {
  const { dom, placeholder } = createHarness();
  assert.equal(placeholder.phase.value, "idle");
  assert.equal(dom.pendingDelay(), 6000);

  dom.fire();
  assert.equal(placeholder.text.value, "第一条");
  assert.equal(placeholder.phase.value, "appear");
  assert.equal(dom.pendingDelay(), 1000);

  dom.fire();
  assert.equal(placeholder.phase.value, "hold");
  assert.equal(placeholder.text.value, "第一条");
  assert.equal(dom.pendingDelay(), 3000);

  dom.fire();
  assert.equal(placeholder.phase.value, "disappear");
  assert.equal(placeholder.text.value, "第一条");
  assert.equal(dom.pendingDelay(), 2000);

  dom.fire();
  assert.equal(placeholder.phase.value, "idle");
  assert.equal(placeholder.text.value, "");
  assert.equal(dom.pendingDelay(), 6000);

  dom.fire();
  assert.equal(placeholder.text.value, "第二条");
  assert.equal(placeholder.phase.value, "appear");

  placeholder.stop();
  dom.restore();
});

test("stays idle when there are no configured prompts", () => {
  const { dom, placeholder } = createHarness([]);
  dom.fire();
  assert.equal(placeholder.text.value, "");
  assert.equal(placeholder.phase.value, "idle");
  assert.ok(dom.hasPending(), "keeps polling for later prompts");
  placeholder.stop();
  dom.restore();
});

test("stop clears the timer and removes the visibility listener", () => {
  const { dom, placeholder } = createHarness();
  assert.equal(dom.listenerCount("visibilitychange"), 1);
  placeholder.stop();
  assert.equal(dom.hasPending(), false);
  assert.equal(dom.listenerCount("visibilitychange"), 0);
  dom.restore();
});
