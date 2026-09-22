import assert from "node:assert/strict";
import test from "node:test";
import { loadUnconfirmedSends, saveUnconfirmedSends, unconfirmedSendsKey } from "./unconfirmedSends.js";

test("unconfirmed messages survive a reload and remain scoped to one account", () => {
  const values = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key)
    }
  });
  try {
    const row = {
      clientRequestId: "123e4567-e89b-42d3-a456-426614174000",
      channelId: 7,
      draft: "平安",
      payload: { channelId: 7, content: "平安", type: "text", replyToId: null, clientRequestId: "123e4567-e89b-42d3-a456-426614174000" }
    };
    saveUnconfirmedSends(1, [row]);
    assert.deepEqual(loadUnconfirmedSends(1), [row]);
    assert.deepEqual(loadUnconfirmedSends(2), []);
    saveUnconfirmedSends(1, []);
    assert.equal(values.has(unconfirmedSendsKey(1)), false);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
