import assert from "node:assert/strict";
import test from "node:test";
import { bottleMotion } from "./bottleMotion";

test("automatic sensors wait for a gesture, respect denial and disable, and allow a settings retry", async (t) => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  t.after(() => {
    for (const [key, descriptor] of [["window", previousWindow], ["navigator", previousNavigator]] as const) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  let calls = 0;
  let permission = "denied";
  let failed = false;
  const requestPermission = () => { calls++; return failed ? Promise.reject(new Error("Unavailable")) : Promise.resolve(permission); };
  const environment = { isSecureContext: true, DeviceMotionEvent: { requestPermission }, DeviceOrientationEvent: { requestPermission } };
  Object.defineProperty(globalThis, "window", { configurable: true, value: environment });
  // Some browsers expose requestPermission without navigator.userActivation.
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
  await bottleMotion.request(true);
  assert.equal(bottleMotion.status.value, "waiting");
  assert.equal(calls, 0);
  const pending = bottleMotion.request(true, true);
  assert.equal(calls, 2, "both permission calls occur synchronously in the gesture");
  await pending;
  assert.equal(bottleMotion.status.value, "denied");
  await bottleMotion.request(true, true);
  assert.equal(calls, 2, "denial must not cause repeated automatic prompts");
  permission = "granted";
  await bottleMotion.request();
  assert.equal(bottleMotion.enabled.value, true);
  bottleMotion.disable();
  await bottleMotion.request(true, true);
  assert.equal(calls, 4, "an explicit disable must survive further interactions");
  assert.equal(bottleMotion.enabled.value, false);
  assert.equal(bottleMotion.status.value, "disabled");
  failed = true;
  await bottleMotion.request();
  assert.equal(bottleMotion.status.value, "error");
  assert.equal(bottleMotion.busy.value, false);
  failed = false;
  await bottleMotion.request();
  assert.equal(bottleMotion.enabled.value, true);
  bottleMotion.disable();
  environment.isSecureContext = false;
  await bottleMotion.request();
  assert.equal(bottleMotion.status.value, "unsupported");
});
