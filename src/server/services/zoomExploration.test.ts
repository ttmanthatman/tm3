import assert from "node:assert/strict";
import test from "node:test";
import { createZoomExplorationHandler } from "./zoomExploration.js";
import type { WorldExplorerDTO } from "../../shared/worldExploration.js";

type Dependencies = Parameters<typeof createZoomExplorationHandler>[0];
function fixture(overrides: Partial<Dependencies> = {}) {
  const published: WorldExplorerDTO[] = [];
  let clock = 0;
  const deps: Dependencies = {
    refreshAuth: async () => ({ accountId: 1 }),
    loadMessage: async () => ({ channelId: 2, type: "system", payload: { kind: "zoom_meeting", status: "inactive" } }),
    canAccessChannel: async () => true,
    profile: () => ({ accountId: 1, displayName: "探索者" }),
    connected: () => true,
    broadcast: profile => { published.push(profile); },
    now: () => clock,
    ...overrides
  };
  return { handler: createZoomExplorationHandler(deps), published, tick: () => { clock += 1_000; } };
}

test("exploration uses the authenticated profile and throttles repeated clicks", async () => {
  const f = fixture();
  await f.handler({ messageId: 5 });
  await f.handler({ messageId: 5 });
  assert.deepEqual(f.published, [{ accountId: 1, displayName: "探索者" }]);
  f.tick();
  await f.handler({ messageId: 5 });
  assert.equal(f.published.length, 2);
});

test("malformed or forged exploration payloads never publish", async () => {
  for (const payload of [null, {}, { messageId: -1 }, { messageId: 1.5 }, { messageId: 2_147_483_648 }, { messageId: "5" }, { messageId: 5, displayName: "伪造" }]) {
    const f = fixture();
    await f.handler(payload);
    assert.deepEqual(f.published, []);
  }
});

test("guests, expired sessions, inaccessible channels and disconnected sockets cannot publish", async () => {
  for (const overrides of [
    { refreshAuth: async () => null }, { refreshAuth: async () => ({ accountId: 1, isGuest: true }) },
    { canAccessChannel: async () => false }, { connected: () => false },
    { profile: () => undefined }, { profile: () => ({ accountId: 2, displayName: "别人" }) }
  ]) {
    const f = fixture(overrides);
    await f.handler({ messageId: 5 });
    assert.deepEqual(f.published, []);
  }
});

test("only a real ended Zoom system message can trigger exploration", async () => {
  for (const message of [null,
    { channelId: 2, type: "text", payload: { kind: "zoom_meeting", status: "inactive" } },
    { channelId: 2, type: "system", payload: null },
    { channelId: 2, type: "system", payload: { kind: "zoom_meeting", status: "active", url: "https://zoom.us/j/123456789" } }
  ]) {
    const f = fixture({ loadMessage: async () => message });
    await f.handler({ messageId: 5 });
    assert.deepEqual(f.published, []);
  }
});
