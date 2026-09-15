import assert from "node:assert/strict";
import test from "node:test";

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

const { api } = await import("./api");

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => data,
    text: async () => JSON.stringify(data)
  } as unknown as Response;
}

test("GET retries the transport once after a network failure", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("fetch failed");
    return jsonResponse({ ok: true });
  }) as typeof fetch;

  const result = await api<{ ok: boolean }>("/api/anything");
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
});

test("GET does not retry HTTP error responses", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return jsonResponse({ success: false, message: "boom" }, 500);
  }) as typeof fetch;

  await assert.rejects(api("/api/anything"), /boom/);
  assert.equal(calls, 1);
});

test("GET gives up after one transport retry", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new TypeError("fetch failed");
  }) as typeof fetch;

  await assert.rejects(api("/api/anything"), /fetch failed/);
  assert.equal(calls, 2);
});

test("POST never retries, even on transport failure", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new TypeError("fetch failed");
  }) as typeof fetch;

  await assert.rejects(api("/api/anything", { method: "POST", body: "{}" }), /fetch failed/);
  assert.equal(calls, 1);
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flushMicrotasks() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

// Emulates a real fetch: response headers resolve immediately, the body read
// stays pending until the attempt's signal aborts (which rejects the read).
function hangingBodyFetch(calls: { count: number }) {
  return (async (_url: string, init?: RequestInit) => {
    calls.count += 1;
    const body = deferred<unknown>();
    init?.signal?.addEventListener("abort", () => body.reject(init.signal?.reason), { once: true });
    return {
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null) },
      json: () => body.promise,
      text: () => body.promise
    } as unknown as Response;
  }) as typeof fetch;
}

test("GET times out when response headers arrive but the body stalls", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = { count: 0 };
  globalThis.fetch = hangingBodyFetch(calls);

  const promise = api("/api/anything");
  const assertion = assert.rejects(promise, /请求超时/);
  await flushMicrotasks();
  t.mock.timers.tick(20_000);
  await flushMicrotasks();
  t.mock.timers.tick(400);
  await flushMicrotasks();
  t.mock.timers.tick(20_000);
  await assertion;
  assert.equal(calls.count, 2);
});

test("GET retries once when the body stream fails mid-read", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) {
      return {
        ok: true,
        status: 200,
        headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null) },
        json: async () => {
          throw new TypeError("network error");
        },
        text: async () => {
          throw new TypeError("network error");
        }
      } as unknown as Response;
    }
    return jsonResponse({ ok: true });
  }) as typeof fetch;

  const promise = api<{ ok: boolean }>("/api/anything");
  await flushMicrotasks();
  t.mock.timers.tick(400);
  const result = await promise;
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
});

test("GET aborted before the call never issues a request", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return jsonResponse({ ok: true });
  }) as typeof fetch;

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(api("/api/anything", { signal: controller.signal }), isAbortError);
  assert.equal(calls, 0);
});

test("GET aborted while reading the body rejects without retrying", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = { count: 0 };
  globalThis.fetch = hangingBodyFetch(calls);

  const controller = new AbortController();
  const promise = api("/api/anything", { signal: controller.signal });
  const assertion = assert.rejects(promise, isAbortError);
  await flushMicrotasks();
  controller.abort();
  await assertion;
  t.mock.timers.tick(400);
  t.mock.timers.tick(20_000);
  await flushMicrotasks();
  assert.equal(calls.count, 1);
});

test("GET aborted during the retry backoff stops without a second request", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new TypeError("fetch failed");
  }) as typeof fetch;

  const controller = new AbortController();
  const promise = api("/api/anything", { signal: controller.signal });
  const assertion = assert.rejects(promise, isAbortError);
  await flushMicrotasks();
  controller.abort();
  await assertion;
  t.mock.timers.tick(400);
  await flushMicrotasks();
  assert.equal(calls, 1);
});

test("GET keeps the built-in timeout when an external signal is provided", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = { count: 0 };
  globalThis.fetch = hangingBodyFetch(calls);

  const controller = new AbortController();
  const promise = api("/api/anything", { signal: controller.signal });
  const assertion = assert.rejects(promise, /请求超时/);
  await flushMicrotasks();
  t.mock.timers.tick(20_000);
  await flushMicrotasks();
  t.mock.timers.tick(400);
  await flushMicrotasks();
  t.mock.timers.tick(20_000);
  await assertion;
  assert.equal(calls.count, 2);
});
