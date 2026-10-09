import assert from "node:assert/strict";
import test from "node:test";
import { effectScope, nextTick, ref } from "vue";
import { createPinia, setActivePinia } from "pinia";
import type { MessageDTO } from "@shared/types";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key)
} });
Object.defineProperty(globalThis, "window", { configurable: true, value: { innerWidth: 1024 } });
const { useChatStore } = await import("../../store");
const { useVirtualTimeline } = await import("./useVirtualTimeline");

function message(id: number): MessageDTO {
  return { id, type: "image", createdAt: "2026-10-09T00:00:00.000Z" } as MessageDTO;
}

function harness(queue: MessageDTO[] = []) {
  setActivePinia(createPinia());
  const store = useChatStore();
  const active = ref(true);
  const scope = effectScope();
  let estimates = 0;
  const timeline = scope.run(() => useVirtualTimeline({
    scroller: ref(null),
    isActive: () => active.value,
    estimateRowHeight: () => { estimates += 1; return 80; },
    computeWindow: () => ({ start: 0, end: 2, topSpacer: 0, bottomSpacer: 0, renderedHeight: 160, totalHeight: 160 }),
    imagePreloadQueue: queue,
    queuedImagePreloads: new Set(queue.map((entry) => entry.id)),
    fileThumbUrl: (entry) => `/thumb/${entry.id}`
  }))!;
  return { store, active, scope, timeline, estimates: () => estimates };
}

test("occluded chat freezes timeline derivation and viewport work, then resumes with received messages", async () => {
  const h = harness();
  try {
    h.store.messages = [message(1)];
    const rows = h.timeline.timeline.value;
    const items = h.timeline.virtualTimelineItems.value;
    const estimateCount = h.estimates();
    h.active.value = false;
    h.store.messages.push(message(2));
    await nextTick();
    assert.equal(h.timeline.timeline.value, rows);
    assert.equal(h.timeline.virtualTimelineItems.value, items);
    assert.equal(h.estimates(), estimateCount);
    h.timeline.syncVirtualTimelineViewport({ get scrollTop(): number { throw new Error("hidden DOM measured"); } } as HTMLElement);
    assert.equal(h.timeline.timelineViewportWidth.value, 1024);
    h.active.value = true;
    assert.deepEqual(h.timeline.timeline.value.flatMap((row) => row.kind === "message" ? [row.message.id] : []), [1, 2]);
    assert.ok(h.timeline.virtualTimelineItems.value.length > items.length);
    assert.ok(h.estimates() > estimateCount);
  } finally { h.scope.stop(); }
});

test("finishing image requests cannot continue draining the queue while chat is occluded", async () => {
  const h = harness([message(1), message(2), message(3)]);
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  const finish: (() => void)[] = [];
  globalThis.fetch = (input) => {
    requests.push(String(input));
    return new Promise<Response>((resolve) => finish.push(() => resolve(new Response("image"))));
  };
  try {
    h.timeline.pumpMessageImagePreloads();
    assert.deepEqual(requests, ["/thumb/1", "/thumb/2"]);
    h.active.value = false;
    finish.splice(0).forEach((resolve) => resolve());
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(requests.length, 2);
    h.active.value = true;
    h.timeline.pumpMessageImagePreloads();
    assert.deepEqual(requests, ["/thumb/1", "/thumb/2", "/thumb/3"]);
    finish.splice(0).forEach((resolve) => resolve());
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    globalThis.fetch = originalFetch;
    h.scope.stop();
  }
});
