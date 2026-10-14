import assert from "node:assert/strict";
import test from "node:test";
import { pendingNotificationReads, queueNotificationRead, completeNotificationRead, knownNotificationReads, rememberNotificationRead } from "./notificationReadQueue";

test("pending acknowledgements survive reloads, isolate accounts and keep other concurrent writes", () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  } });
  const mention = { kind: "mention", id: 100 } as const;
  queueNotificationRead(1, mention);
  queueNotificationRead(1, mention);
  queueNotificationRead(1, { kind: "favorite", id: 2 });
  assert.deepEqual(pendingNotificationReads(1), [mention, { kind: "favorite", id: 2 }]);
  assert.deepEqual(pendingNotificationReads(2), []);
  rememberNotificationRead(1, mention);
  completeNotificationRead(1, mention);
  assert.deepEqual(pendingNotificationReads(1), [{ kind: "favorite", id: 2 }]);
  assert.deepEqual(knownNotificationReads(1), [mention]);
  assert.deepEqual(knownNotificationReads(2), []);
});
