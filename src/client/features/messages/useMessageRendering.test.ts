import assert from "node:assert/strict";
import test from "node:test";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import type { AccountDTO, MessageDTO } from "../../../shared/types";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
}

Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new MemoryStorage() });
Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });

const { useChatStore } = await import("../../store");
const { useMessageRendering } = await import("./useMessageRendering");

function account(id: number): AccountDTO {
  return {
    id,
    username: `user-${id}`,
    displayName: `User ${id}`,
    avatarPath: null,
    isAdmin: false,
    canPinMessages: false,
    actorId: id,
    theme: "default",
    biblePreferences: { outputFormat: "referenceVerseLines", referenceLabelMode: "normalizedFull", combinedPassageMode: "compactEllipsis", quotationStyle: "fullWidth" }
  };
}

function urlMessage(id: number, url: string): MessageDTO {
  return { id, channelId: 1, type: "text", content: url } as MessageDTO;
}

async function settle() {
  for (let round = 0; round < 5; round += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function requestedUrl(input: unknown) {
  return new URL(String(input), "http://localhost").searchParams.get("url") || "";
}

function installFetchMock(handler: (url: string, signal?: AbortSignal) => Promise<Response>) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    calls.push(requestedUrl(input));
    return handler(requestedUrl(input), init?.signal ?? undefined);
  }) as typeof fetch;
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    }
  };
}

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

function freshRendering(visible: () => MessageDTO[], extra: { linkPreviewRetryDelaysMs?: readonly number[] } = {}) {
  setActivePinia(createPinia());
  const store = useChatStore();
  store.account = account(1);
  const rendering = useMessageRendering({
    linkifyMessageHtml: (html) => html,
    isMine: () => false,
    reconcileReadPositionAfterLayout: () => {},
    visibleMessages: visible,
    previewUrlFor: (message) => message.content,
    ...extra
  });
  return { store, rendering };
}

test("只预取可见消息的链接预览", async () => {
  const mock = installFetchMock(async (url) => jsonResponse({ url, title: "标题" }));
  try {
    const messages = Array.from({ length: 10 }, (_, index) => urlMessage(index + 1, `https://example.com/m${index + 1}`));
    const { store, rendering } = freshRendering(() => messages.slice(-2));
    store.messages = messages;
    rendering.ensureVisibleLinkPreviews();
    await settle();
    assert.deepEqual(mock.calls.sort(), ["https://example.com/m10", "https://example.com/m9"]);
  } finally {
    mock.restore();
  }
});

test("切换频道丢弃旧队列并释放并发预算", async () => {
  let visible = Array.from({ length: 6 }, (_, index) => urlMessage(index + 1, `https://example.com/a${index + 1}`));
  const mock = installFetchMock(
    (url, signal) =>
      new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      })
  );
  try {
    const { store, rendering } = freshRendering(() => visible);
    store.messages = visible;
    store.currentChannelId = 1;
    rendering.ensureVisibleLinkPreviews();
    await settle();
    assert.deepEqual(mock.calls, ["https://example.com/a1", "https://example.com/a2", "https://example.com/a3"]);

    visible = Array.from({ length: 3 }, (_, index) => urlMessage(index + 101, `https://example.com/b${index + 1}`));
    store.messages = visible;
    store.currentChannelId = 2;
    await nextTick();
    rendering.ensureVisibleLinkPreviews();
    await settle();
    assert.deepEqual(mock.calls.slice(3).sort(), ["https://example.com/b1", "https://example.com/b2", "https://example.com/b3"]);
    assert.equal(mock.calls.length, 6);

    // 收尾：再切一次频道中止挂起的 b 组请求，释放 api 超时计时器。
    store.currentChannelId = 3;
    await nextTick();
    await settle();
  } finally {
    mock.restore();
  }
});

test("切换账号清空预览缓存", async () => {
  const mock = installFetchMock(async (url) => jsonResponse({ url, title: "标题" }));
  try {
    const messages = [urlMessage(1, "https://example.com/only")];
    const { store, rendering } = freshRendering(() => messages);
    store.messages = messages;
    rendering.ensureVisibleLinkPreviews();
    await settle();
    assert.equal(rendering.linkPreviewCache.value["https://example.com/only"]?.status, "ready");

    store.account = account(2);
    await nextTick();
    assert.deepEqual(rendering.linkPreviewCache.value, {});
  } finally {
    mock.restore();
  }
});

test("失败可重试而不是永久缓存", async () => {
  let fail = true;
  const mock = installFetchMock(async (url) => {
    if (fail) return jsonResponse({ message: "boom" });
    return jsonResponse({ url, title: "标题" });
  });
  // retryDelaysMs: [0] 让失败条目立即可重试；退避节奏由 linkPreviewQueue.test.ts 覆盖。
  try {
    const messages = [urlMessage(1, "https://example.com/flaky")];
    const { store, rendering } = freshRendering(() => messages, { linkPreviewRetryDelaysMs: [0] });
    store.messages = messages;
    rendering.ensureVisibleLinkPreviews();
    await settle();
    assert.equal(rendering.linkPreviewCache.value["https://example.com/flaky"]?.status, "error");
    assert.equal(mock.calls.length, 1);

    fail = false;
    rendering.ensureVisibleLinkPreviews();
    await settle();
    assert.equal(mock.calls.length, 2);
    assert.equal(rendering.linkPreviewCache.value["https://example.com/flaky"]?.status, "ready");
  } finally {
    mock.restore();
  }
});
