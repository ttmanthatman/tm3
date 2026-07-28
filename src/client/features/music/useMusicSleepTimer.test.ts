import assert from "node:assert/strict";
import test from "node:test";
import { ref } from "vue";
import { useMusicSleepTimer, type MusicSleepTimerRuntime } from "./useMusicSleepTimer.js";

function fakeRuntime(startNow = 0) {
  const state = { now: startNow, timers: new Map<number, () => void>(), nextId: 1 };
  const runtime: MusicSleepTimerRuntime = {
    setInterval: (handler) => {
      const id = state.nextId++;
      state.timers.set(id, handler);
      return id;
    },
    clearInterval: (timer) => {
      state.timers.delete(timer);
    },
    now: () => state.now
  };
  return { runtime, state };
}

function advance(state: { now: number; timers: Map<number, () => void> }, ms: number, stepMs = 1000) {
  const target = state.now + ms;
  while (state.now < target) {
    state.now = Math.min(target, state.now + stepMs);
    for (const handler of [...state.timers.values()]) handler();
  }
}

test("minutes timer fires onStop after the requested minutes", () => {
  const { runtime, state } = fakeRuntime();
  const currentTrackId = ref<number | null>(1);
  let stops = 0;
  const timer = useMusicSleepTimer({ currentTrackId, onStop: () => stops++, runtime });

  timer.controls.startMinutes(30);
  assert.equal(timer.state.kind.value, "minutes");
  assert.equal(timer.state.label.value, "30 分 0 秒后停止");

  advance(state, 29 * 60_000);
  assert.equal(stops, 0);
  assert.equal(timer.state.label.value, "1 分 0 秒后停止");

  advance(state, 45_000);
  assert.equal(stops, 0);
  assert.equal(timer.state.label.value, "15 秒后停止");

  advance(state, 15_000);
  assert.equal(stops, 1);
  assert.equal(timer.state.kind.value, "off");
  assert.equal(timer.state.label.value, "");
});

test("tracks timer fires onStop after the requested number of track changes", async () => {
  const { runtime } = fakeRuntime();
  const currentTrackId = ref<number | null>(10);
  let stops = 0;
  const timer = useMusicSleepTimer({ currentTrackId, onStop: () => stops++, runtime });

  timer.controls.startTracks(2);
  assert.equal(timer.state.kind.value, "tracks");
  assert.equal(timer.state.label.value, "还剩 2 首");

  currentTrackId.value = 11;
  await Promise.resolve();
  assert.equal(stops, 0);
  assert.equal(timer.state.label.value, "还剩 1 首");

  currentTrackId.value = 12;
  await Promise.resolve();
  assert.equal(stops, 1);
  assert.equal(timer.state.kind.value, "off");
});

test("tracks timer ignores null and unchanged track ids", async () => {
  const { runtime } = fakeRuntime();
  const currentTrackId = ref<number | null>(10);
  let stops = 0;
  const timer = useMusicSleepTimer({ currentTrackId, onStop: () => stops++, runtime });

  timer.controls.startTracks(1);
  currentTrackId.value = null;
  await Promise.resolve();
  currentTrackId.value = 10;
  await Promise.resolve();
  assert.equal(stops, 0);
  assert.equal(timer.state.label.value, "还剩 1 首");
});

test("cancel disarms the timer", () => {
  const { runtime, state } = fakeRuntime();
  const currentTrackId = ref<number | null>(1);
  let stops = 0;
  const timer = useMusicSleepTimer({ currentTrackId, onStop: () => stops++, runtime });

  timer.controls.startMinutes(10);
  timer.controls.cancel();
  advance(state, 11 * 60_000);
  assert.equal(stops, 0);
  assert.equal(timer.state.kind.value, "off");
});

test("re-arming replaces the previous timer", () => {
  const { runtime, state } = fakeRuntime();
  const currentTrackId = ref<number | null>(1);
  let stops = 0;
  const timer = useMusicSleepTimer({ currentTrackId, onStop: () => stops++, runtime });

  timer.controls.startMinutes(5);
  timer.controls.startMinutes(60);
  advance(state, 6 * 60_000);
  assert.equal(stops, 0);
  assert.equal(state.timers.size, 1);

  advance(state, 55 * 60_000);
  assert.equal(stops, 1);
});

test("invalid inputs do not arm the timer", () => {
  const { runtime } = fakeRuntime();
  const currentTrackId = ref<number | null>(1);
  let stops = 0;
  const timer = useMusicSleepTimer({ currentTrackId, onStop: () => stops++, runtime });

  timer.controls.startMinutes(0);
  timer.controls.startMinutes(Number.NaN);
  timer.controls.startTracks(-3);
  assert.equal(timer.state.kind.value, "off");
  assert.equal(stops, 0);
});
