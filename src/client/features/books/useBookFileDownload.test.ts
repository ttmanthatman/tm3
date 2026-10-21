import assert from "node:assert/strict";
import test from "node:test";
import { effectScope } from "vue";
import { useBookFileDownload } from "./useBookFileDownload";

test("EPUB download saves the authenticated original file even when reading cache is ready", async () => {
  const blob = new Blob(["EPUB content"], { type: "application/epub+zip" });
  const calls: string[] = [];
  const scope = effectScope();
  const action = scope.run(() => useBookFileDownload({
    headers: () => ({ Authorization: "Bearer test" }),
    fetch: async (url, options) => {
      assert.equal(new Headers(options.headers).get("Authorization"), "Bearer test");
      calls.push(url);
      return blob;
    },
    save: (value, name) => { assert.equal(value, blob); calls.push(name); }
  }))!;
  await action.download({ id: 7, title: "纳尼亚传奇 / 套装" });
  assert.deepEqual(calls, ["/api/books/7/file", "纳尼亚传奇 _ 套装.epub"]);
  assert.equal(action.busyIds.value.size, 0);
  assert.equal(action.error.value, "");
  scope.stop();
});

test("duplicate file downloads are ignored and failed downloads can be retried", async () => {
  let fail!: (cause: Error) => void;
  let reads = 0;
  const scope = effectScope();
  const action = scope.run(() => useBookFileDownload({
    headers: () => ({}),
    fetch: async () => { reads++; return new Promise<Blob>((_resolve, reject) => { fail = reject; }); },
    save: () => assert.fail("failed download must not save a file")
  }))!;
  const first = action.download({ id: 1, title: "示例" });
  assert.equal(action.busyIds.value.has(1), true);
  await action.download({ id: 1, title: "示例" });
  assert.equal(reads, 1);
  fail(new Error("网络连接失败"));
  await first;
  assert.equal(action.error.value, "网络连接失败");
  assert.equal(action.busyIds.value.has(1), false);
  const retry = action.download({ id: 1, title: "示例" });
  assert.equal(reads, 2);
  assert.equal(action.error.value, "");
  fail(new Error("HTTP 403"));
  await retry;
  scope.stop();
});

test("closing the workspace aborts pending files and never saves a late response", async () => {
  let finish!: (blob: Blob) => void;
  let signal: AbortSignal | undefined;
  const scope = effectScope();
  const action = scope.run(() => useBookFileDownload({
    headers: () => ({}),
    fetch: async (_url, options) => { signal = options.signal; return new Promise<Blob>(resolve => { finish = resolve; }); },
    save: () => assert.fail("closed workspace must not save a file")
  }))!;
  const pending = action.download({ id: 1, title: "示例.epub" });
  scope.stop();
  assert.equal(signal?.aborted, true);
  finish(new Blob(["late"]));
  await pending;
  assert.equal(action.error.value, "");
});
