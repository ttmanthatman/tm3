import assert from "node:assert/strict";
import test from "node:test";
import type { LinkPreviewDTO } from "../../../shared/types";
import { createLinkPreviewQueue } from "./linkPreviewQueue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function settle() {
  for (let round = 0; round < 5; round += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function preview(url: string): LinkPreviewDTO {
  return { url, title: `标题 ${url}` } as LinkPreviewDTO;
}

function hangingFetcher(calls: string[]) {
  const pending = new Map<string, ReturnType<typeof deferred<LinkPreviewDTO>>>();
  const fetchPreview = (url: string, signal: AbortSignal) => {
    calls.push(url);
    const entry = deferred<LinkPreviewDTO>();
    pending.set(url, entry);
    signal.addEventListener("abort", () => entry.reject(signal.reason), { once: true });
    return entry.promise;
  };
  return { fetchPreview, pending };
}

test("并发不超过 3，完成的槽位才放行后续请求", async () => {
  const calls: string[] = [];
  const { fetchPreview, pending } = hangingFetcher(calls);
  const queue = createLinkPreviewQueue({ fetchPreview });
  queue.ensureVisible(["a", "b", "c", "d", "e"]);
  assert.deepEqual(calls, ["a", "b", "c"]);
  pending.get("a")!.resolve(preview("a"));
  await settle();
  assert.deepEqual(calls, ["a", "b", "c", "d"]);
});

test("reset 丢弃排队任务并中止进行中请求，旧任务不再占用并发预算", async () => {
  const calls: string[] = [];
  const { fetchPreview } = hangingFetcher(calls);
  const queue = createLinkPreviewQueue({ fetchPreview });
  queue.ensureVisible(["old-1", "old-2", "old-3", "old-4", "old-5"]);
  assert.deepEqual(calls, ["old-1", "old-2", "old-3"]);

  queue.reset();
  await settle();
  queue.ensureVisible(["new-1", "new-2", "new-3"]);
  await settle();
  assert.deepEqual(calls, ["old-1", "old-2", "old-3", "new-1", "new-2", "new-3"]);
});

test("主动取消不写入失败缓存，回到可见范围时可重新请求", async () => {
  const calls: string[] = [];
  const { fetchPreview, pending } = hangingFetcher(calls);
  const queue = createLinkPreviewQueue({ fetchPreview });
  queue.ensureVisible(["a"]);
  queue.reset();
  await settle();
  assert.equal(queue.state()["a"], undefined);

  queue.ensureVisible(["a"]);
  await settle();
  pending.get("a")!.resolve(preview("a"));
  await settle();
  assert.equal(queue.state()["a"]?.status, "ready");
  assert.deepEqual(calls, ["a", "a"]);
});

test("失败按退避重试，超过次数后本会话内停止", async () => {
  const calls: string[] = [];
  let currentTime = 1_000_000;
  const queue = createLinkPreviewQueue({
    fetchPreview: async (url) => {
      calls.push(url);
      throw new Error("HTTP 500");
    },
    now: () => currentTime,
    retryDelaysMs: [1_000, 5_000]
  });
  queue.ensureVisible(["a"]);
  await settle();
  assert.equal(queue.state()["a"]?.status, "error");
  assert.equal(calls.length, 1);

  queue.ensureVisible(["a"]);
  await settle();
  assert.equal(calls.length, 1);

  currentTime += 1_000;
  queue.ensureVisible(["a"]);
  await settle();
  assert.equal(calls.length, 2);

  currentTime += 5_000;
  queue.ensureVisible(["a"]);
  await settle();
  assert.equal(calls.length, 3);

  currentTime += 60_000;
  queue.ensureVisible(["a"]);
  await settle();
  assert.equal(calls.length, 3);
});

test("缓存有界，超限淘汰最旧的已完成条目", async () => {
  const queue = createLinkPreviewQueue({
    fetchPreview: async (url) => preview(url),
    cacheLimit: 4
  });
  queue.ensureVisible(["u0", "u1", "u2", "u3"]);
  await settle();
  queue.ensureVisible(["u4", "u5"]);
  await settle();
  const keys = Object.keys(queue.state());
  assert.equal(keys.length, 4);
  assert.deepEqual(keys, ["u2", "u3", "u4", "u5"]);
});

test("clearCache 清空全部缓存；普通 reset 保留已完成预览", async () => {
  const queue = createLinkPreviewQueue({ fetchPreview: async (url) => preview(url) });
  queue.ensureVisible(["a", "b"]);
  await settle();
  assert.equal(queue.state()["a"]?.status, "ready");

  queue.reset();
  assert.equal(queue.state()["a"]?.status, "ready");

  queue.reset({ clearCache: true });
  assert.deepEqual(queue.state(), {});
});

test("ensureVisible 丢弃不再可见的排队项", async () => {
  const calls: string[] = [];
  const { fetchPreview, pending } = hangingFetcher(calls);
  const queue = createLinkPreviewQueue({ fetchPreview });
  queue.ensureVisible(["a", "b", "c", "d"]);
  assert.deepEqual(calls, ["a", "b", "c"]);

  queue.ensureVisible(["a", "b", "c"]);
  pending.get("a")!.resolve(preview("a"));
  await settle();
  assert.deepEqual(calls, ["a", "b", "c"]);
});
