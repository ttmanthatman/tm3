import assert from "node:assert/strict";
import test from "node:test";
import { randomId } from "./randomId.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("randomId returns RFC4122 v4 UUID strings", () => {
  for (let index = 0; index < 20; index += 1) {
    assert.match(randomId(), UUID_PATTERN);
  }
});

test("randomId falls back when crypto.randomUUID is unavailable (plain HTTP origins)", () => {
  const original = globalThis.crypto;
  const fallback = {
    getRandomValues: (buffer: Uint8Array) => original.getRandomValues(buffer)
  } as Crypto;
  Object.defineProperty(globalThis, "crypto", { value: fallback, configurable: true });
  try {
    const id = randomId();
    assert.match(id, UUID_PATTERN);
    assert.notEqual(id, randomId());
  } finally {
    Object.defineProperty(globalThis, "crypto", { value: original, configurable: true });
  }
});

test("randomId falls back to Math.random when no crypto API exists at all", () => {
  const original = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
  try {
    assert.match(randomId(), UUID_PATTERN);
  } finally {
    Object.defineProperty(globalThis, "crypto", { value: original, configurable: true });
  }
});
