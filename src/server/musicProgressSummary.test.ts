import assert from "node:assert/strict";
import test from "node:test";
import { createMusicProgressTracker, type MusicProgressEvent, type MusicProgressLogInput } from "./services/musicProgressSummary.js";

const PLAYBACK_ID = "4b8f7f1e-9d6b-4c3a-8f2e-1a2b3c4d5e6f";
const OTHER_PLAYBACK_ID = "9c1a2b3c-4d5e-6f70-8123-456789abcdef";

function baseEvent(overrides: Partial<MusicProgressEvent> = {}): MusicProgressEvent {
  return {
    accountId: 7,
    sessionId: "session-1",
    trackId: 42,
    playbackId: PLAYBACK_ID,
    state: "progress",
    progressMs: 5_000,
    listenedMs: 5_000,
    durationMs: 180_000,
    appVersion: "1.2.3",
    latestVersion: "1.2.3",
    isLatestVersion: true,
    ...overrides
  };
}

function createHarness(idleMs = 60_000) {
  const rows: MusicProgressLogInput[] = [];
  const tracker = createMusicProgressTracker({
    idleMs,
    write: async (input) => {
      rows.push(input);
    }
  });
  return { rows, tracker };
}

test("terminal ended flushes exactly one summary row marked as finished", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => t.mock.timers.reset());
  const { rows, tracker } = createHarness();

  tracker.record(baseEvent({ state: "started", progressMs: 0, listenedMs: 0 }));
  tracker.record(baseEvent({ state: "progress", progressMs: 5_000, listenedMs: 5_000 }));
  tracker.record(baseEvent({ state: "progress", progressMs: 10_000, listenedMs: 10_000 }));
  tracker.record(baseEvent({ state: "ended", progressMs: 180_000, listenedMs: 175_000 }));
  await tracker.flushAll();

  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.kind, "music_progress");
  assert.equal(row.state, "ended");
  assert.equal(row.playbackId, PLAYBACK_ID);
  assert.equal(row.trackId, 42);
  assert.equal(row.accountId, 7);
  assert.equal(row.sessionId, "session-1");
  assert.equal(row.progressMs, 180_000);
  assert.equal(row.listenedMs, 175_000);
  assert.equal(row.durationMs, 180_000);
  assert.equal(row.appVersion, "1.2.3");
  assert.equal(row.latestVersion, "1.2.3");
  assert.equal(row.isLatestVersion, true);
});

test("changed, error and idle flushes are summarized as paused, not finished", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => t.mock.timers.reset());
  const { rows, tracker } = createHarness();

  tracker.record(baseEvent({ state: "started", progressMs: 0, listenedMs: 0 }));
  tracker.record(baseEvent({ state: "changed", progressMs: 30_000, listenedMs: 30_000 }));
  tracker.record(baseEvent({ state: "started", progressMs: 0, listenedMs: 0 }));
  tracker.record(baseEvent({ state: "error", progressMs: 2_000, listenedMs: 2_000 }));
  tracker.record(baseEvent({ state: "started", progressMs: 0, listenedMs: 0 }));
  tracker.record(baseEvent({ state: "paused", progressMs: 60_000, listenedMs: 55_000 }));
  t.mock.timers.tick(60_000);
  await tracker.flushAll();

  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.state), ["paused", "paused", "paused"]);
  assert.equal(rows[2].listenedMs, 55_000);
  assert.equal(rows[2].progressMs, 60_000);
});

test("idle timer flushes abandoned sessions once without a terminal event", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => t.mock.timers.reset());
  const { rows, tracker } = createHarness();

  tracker.record(baseEvent({ state: "started", progressMs: 0, listenedMs: 0 }));
  t.mock.timers.tick(59_999);
  assert.equal(rows.length, 0);
  t.mock.timers.tick(1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, "paused");

  t.mock.timers.tick(120_000);
  assert.equal(rows.length, 1);
});

test("progress activity re-arms the idle timer and merges max listenedMs with latest progress", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => t.mock.timers.reset());
  const { rows, tracker } = createHarness();

  tracker.record(baseEvent({ state: "started", progressMs: 0, listenedMs: 0 }));
  t.mock.timers.tick(50_000);
  tracker.record(baseEvent({ state: "progress", progressMs: 50_000, listenedMs: 45_000 }));
  t.mock.timers.tick(50_000);
  assert.equal(rows.length, 0);
  tracker.record(baseEvent({ state: "progress", progressMs: 95_000, listenedMs: 40_000 }));
  tracker.record(baseEvent({ state: "ended", progressMs: 100_000, listenedMs: 90_000 }));
  await tracker.flushAll();

  assert.equal(rows.length, 1);
  assert.equal(rows[0].listenedMs, 90_000);
  assert.equal(rows[0].progressMs, 100_000);
  assert.equal(rows[0].state, "ended");
});

test("sessions are keyed by playbackId and flush independently", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => t.mock.timers.reset());
  const { rows, tracker } = createHarness();

  tracker.record(baseEvent({ state: "started", progressMs: 0, listenedMs: 0 }));
  tracker.record(baseEvent({ state: "started", playbackId: OTHER_PLAYBACK_ID, trackId: 77, progressMs: 0, listenedMs: 0 }));
  tracker.record(baseEvent({ state: "ended", progressMs: 180_000, listenedMs: 170_000 }));
  t.mock.timers.tick(60_000);
  await tracker.flushAll();

  assert.equal(rows.length, 2);
  const ended = rows.find((row) => row.playbackId === PLAYBACK_ID);
  const abandoned = rows.find((row) => row.playbackId === OTHER_PLAYBACK_ID);
  assert.equal(ended?.state, "ended");
  assert.equal(abandoned?.state, "paused");
  assert.equal(abandoned?.trackId, 77);
});

test("flushAll writes one paused summary for every pending session", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => t.mock.timers.reset());
  const { rows, tracker } = createHarness();

  tracker.record(baseEvent({ state: "progress", progressMs: 10_000, listenedMs: 10_000 }));
  tracker.record(baseEvent({ state: "progress", playbackId: OTHER_PLAYBACK_ID, progressMs: 20_000, listenedMs: 20_000 }));
  await tracker.flushAll();

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.state), ["paused", "paused"]);

  await tracker.flushAll();
  assert.equal(rows.length, 2);
});

test("dispose clears pending timers without writing rows", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => t.mock.timers.reset());
  const { rows, tracker } = createHarness();

  tracker.record(baseEvent({ state: "started", progressMs: 0, listenedMs: 0 }));
  tracker.record(baseEvent({ state: "progress", progressMs: 5_000, listenedMs: 5_000 }));
  tracker.dispose();
  t.mock.timers.tick(600_000);
  await tracker.flushAll();

  assert.equal(rows.length, 0);
});
