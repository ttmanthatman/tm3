import assert from "node:assert/strict";
import test from "node:test";
import { createBookProgressSync, type BookSyncState } from "./bookProgressSync";
import type { BookProgressSnapshot, BookProgressWrite } from "@shared/bookLocator";

const remote = (revision = 0, fraction: number | null = null): BookProgressSnapshot => ({ bookId: 1, publicationRevision: "a".repeat(64), revision, fraction, locator: null, locatorRevision: null });
function harness(values = new Map<string, string>()) {
  let accountId = 7, server = remote(), online = true, conflict = false;
  let intercept: ((input: BookProgressWrite) => Promise<void>) | undefined;
  const states: BookSyncState[] = [], writes: BookProgressWrite[] = [];
  const sync = createBookProgressSync({ accountId: () => accountId, storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } },
    changed: state => states.push(state), async request(_bookId, input) {
      if (!online) throw new Error("offline");
      if (!input) return { status: 200, progress: server };
      writes.push(input); await intercept?.(input);
      if (conflict || input.baseRevision !== server.revision) return { status: 409, progress: server };
      server = { ...server, fraction: input.fraction, revision: server.revision + 1 };
      return { status: 200, progress: server };
    } });
  return { sync, states, values, writes, account: (id: number) => { accountId = id; }, online: (value: boolean) => { online = value; },
    conflict: (value: boolean) => { conflict = value; }, intercept: (value?: typeof intercept) => { intercept = value; }, server: (value: BookProgressSnapshot) => { server = value; } };
}
test("offline progress is retained and a failed write never marks it saved", async () => {
  const h = harness(); await h.sync.open(1); h.online(false);
  h.sync.record({ bookId: 1, fraction: .2 }); await h.sync.flush();
  assert.equal(h.states.at(-1)?.status, "offline");
  assert.equal(JSON.parse(h.values.get("book-progress.v2.7.1")!).pending.fraction, .2);
  h.online(true); await h.sync.flush(); assert.equal(h.states.at(-1)?.status, "saved");
  assert.equal(JSON.parse(h.values.get("book-progress.v2.7.1")!).pending, undefined);
});
test("new reading while a write is in flight coalesces onto its acknowledged revision", async () => {
  const h = harness(); await h.sync.open(1);
  let release!: () => void;
  h.intercept(() => new Promise<void>(resolve => { release = resolve; }));
  h.sync.record({ bookId: 1, fraction: .8 }); const saving = h.sync.flush();
  h.sync.record({ bookId: 1, fraction: .1 }); h.intercept(); release(); await saving;
  assert.deepEqual(h.writes.map(value => [value.fraction, value.baseRevision]), [[.8, 0], [.1, 1]]);
  assert.equal(h.states.at(-1)?.status, "saved");
});
test("conflicts keep backward local reading until the reader explicitly chooses", async () => {
  const h = harness(); await h.sync.open(1); h.server(remote(2, .9));
  h.sync.record({ bookId: 1, fraction: .1 }); await h.sync.flush();
  assert.equal(h.states.at(-1)?.status, "conflict");
  h.sync.record({ bookId: 1, fraction: .08 }); await h.sync.flush(); assert.equal(h.writes.length, 1);
  h.sync.resolve("local"); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.writes.at(-1)?.fraction, .08); assert.equal(h.writes.at(-1)?.baseRevision, 2);
  h.server(remote(4, .7)); h.sync.record({ bookId: 1, fraction: .05 }); await h.sync.flush();
  assert.deepEqual(h.sync.resolve("remote"), { bookId: 1, fraction: .7 });
});
test("close persists and submits the old book, account changes cannot send its queue", async () => {
  const h = harness(); await h.sync.open(1); h.sync.record({ bookId: 1, fraction: .3 }); h.sync.close();
  await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(h.writes.length, 1);
  await h.sync.open(1); h.sync.record({ bookId: 1, fraction: .4 }); h.account(8); await h.sync.flush();
  assert.equal(h.writes.length, 1); h.sync.stop();
  await h.sync.open(1); assert.ok(h.values.has("book-progress.v2.8.1"));
  assert.equal(JSON.parse(h.values.get("book-progress.v2.7.1")!).pending.fraction, .4);
});
test("a conflict survives close and a new reader session without silently overwriting the remote", async () => {
  const first = harness(); await first.sync.open(1); first.server(remote(3, .8));
  first.sync.record({ bookId: 1, fraction: .2 }); await first.sync.flush();
  first.sync.record({ bookId: 1, fraction: .1 }); first.sync.close();
  const next = harness(first.values); next.server(remote(3, .8));
  const restored = await next.sync.open(1);
  assert.equal(restored.location?.fraction, .1); assert.equal(next.states.at(-1)?.status, "conflict");
  await next.sync.flush(); assert.equal(next.writes.length, 0);
  next.sync.resolve("local"); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(next.writes[0]?.baseRevision, 3); assert.equal(next.writes[0]?.fraction, .1);
});
