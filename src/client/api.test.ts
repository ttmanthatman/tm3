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
