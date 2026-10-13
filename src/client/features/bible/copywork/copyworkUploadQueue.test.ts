import assert from "node:assert/strict";
import test from "node:test";
import { createCopyworkUploadQueue } from "./copyworkUploadQueue";

function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
test("completed glyphs upload immediately; slow saves coalesce rewrites and final flush waits", async () => {
  const gate = deferred();
  const writes: string[] = [];
  const q = createCopyworkUploadQueue({
    create: async () => ({ completed: false }),
    put: async (id, index, body) => { writes.push(`${id}:${index}:${body}`); if (writes.length === 1) await gate.promise; },
    status: () => {}, error: () => assert.fail("unexpected upload error")
  });
  q.configure("a", "normal"); q.enqueue(0, "original");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, ["a:0:original"]);
  q.enqueue(1, "next"); q.enqueue(0, "rewrite"); q.enqueue(0, "latest");
  let finished = false;
  const flushing = q.flush().then(() => { finished = true; });
  assert.equal(finished, false);
  gate.resolve(); await flushing;
  assert.deepEqual(writes, ["a:0:original", "a:0:latest", "a:1:next"]);
  q.enqueue(0, "latest"); await q.flush();
  assert.equal(writes.length, 3);
});
test("failed writes remain retryable with the same work ID and position", async () => {
  let fails = true; const errors: unknown[] = []; const ids: string[] = [];
  const q = createCopyworkUploadQueue({ create: async () => ({ completed: false }),
    put: async (id) => { ids.push(id); if (fails) throw new Error("offline"); }, status: () => {}, error: (e) => errors.push(e) });
  q.configure("retry", "normal"); q.enqueue(0, "ink");
  await assert.rejects(q.flush(), /offline/);
  fails = false; await q.flush();
  assert.deepEqual(ids, ["retry", "retry"]); assert.equal(errors.length, 1);
});
test("changing spacing while a write is pending reuploads to the new work without mixing generations", async () => {
  const gate = deferred(); const writes: string[] = [];
  const q = createCopyworkUploadQueue({ create: async () => ({ completed: false }),
    put: async (id, index) => { writes.push(`${id}:${index}`); if (id === "old") await gate.promise; }, status: () => {}, error: () => {} });
  q.configure("old", "normal"); q.enqueue(0, "old-ink");
  await new Promise((resolve) => setImmediate(resolve));
  q.configure("new", "loose"); q.enqueue(0, "new-ink"); q.enqueue(1, "next");
  gate.resolve(); await q.flush();
  assert.deepEqual(writes, ["old:0", "new:0", "new:1"]);
});
test("a completed retry performs no further PUT and unmount stops queued work", async () => {
  const q = createCopyworkUploadQueue({ create: async () => ({ completed: true }), put: async () => assert.fail("immutable work"), status: () => {}, error: () => {} });
  q.configure("completed", "normal"); q.enqueue(0, "ink"); await q.flush();
  q.stop(); q.enqueue(1, "ink"); await q.flush();
});
