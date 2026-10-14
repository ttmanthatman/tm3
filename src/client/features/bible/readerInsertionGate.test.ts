import assert from "node:assert/strict";
import test from "node:test";
import { createReaderInsertionGate } from "./readerInsertionGate";

test("chapter insertion waits through held contact and subsequent momentum", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const gate = createReaderInsertionGate();
  gate.touchStart();
  let ready = false;
  const waiting = gate.wait().then((value) => { ready = value; });
  t.mock.timers.tick(1000);
  await Promise.resolve();
  assert.equal(ready, false);
  gate.touchEnd();
  t.mock.timers.tick(100);
  gate.motion();
  t.mock.timers.tick(179);
  await Promise.resolve();
  assert.equal(ready, false);
  t.mock.timers.tick(1);
  await waiting;
  assert.equal(ready, true);
});

test("navigation cancels a deferred insertion and does not leave a timer", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const gate = createReaderInsertionGate();
  gate.motion();
  const waiting = gate.wait();
  gate.cancel();
  assert.equal(await waiting, false);
  t.mock.timers.tick(1000);
  assert.equal(await gate.wait(), true);
});
