import assert from "node:assert/strict";
import test from "node:test";
import { createRecordingWakeLock, createVoiceRecordingSession } from "./voiceRecording.js";

test("long voice recordings start without a MediaRecorder timeslice", () => {
  const startArguments: unknown[][] = [];
  const recorder = {
    state: "inactive" as RecordingState,
    start: (...args: unknown[]) => {
      startArguments.push(args);
      recorder.state = "recording";
    },
    stop: () => {
      recorder.state = "inactive";
    }
  };

  const session = createVoiceRecordingSession();
  session.start(recorder);

  assert.deepEqual(startArguments, [[]], "iPhone Safari long recordings must not use periodic timeslice chunks");
});

test("a recorder that stops itself is reported as interrupted", () => {
  const recorder = {
    state: "inactive" as RecordingState,
    start: () => {
      recorder.state = "recording";
    },
    stop: () => {
      recorder.state = "inactive";
    }
  };
  const session = createVoiceRecordingSession();
  session.start(recorder);

  assert.deepEqual(session.consumeStop(), { reason: "interrupted", keepPreview: true });
});

test("user stop keeps the preview while reset discards it", () => {
  const recorder = {
    state: "inactive" as RecordingState,
    start: () => {
      recorder.state = "recording";
    },
    stop: () => {
      recorder.state = "inactive";
    }
  };

  const finished = createVoiceRecordingSession();
  finished.start(recorder);
  finished.stop(recorder, "user");
  assert.deepEqual(finished.consumeStop(), { reason: "user", keepPreview: true });

  const discarded = createVoiceRecordingSession();
  discarded.start(recorder);
  discarded.stop(recorder, "discard");
  assert.deepEqual(discarded.consumeStop(), { reason: "discard", keepPreview: false });
});

test("recording wake lock is held once and released after recording", async () => {
  let requests = 0;
  let releases = 0;
  const sentinel = {
    released: false,
    async release() {
      releases += 1;
      this.released = true;
    }
  };
  const wakeLock = createRecordingWakeLock({
    wakeLock: {
      async request(type) {
        assert.equal(type, "screen");
        requests += 1;
        return sentinel;
      }
    }
  });

  assert.equal(await wakeLock.acquire(), true);
  assert.equal(await wakeLock.acquire(), true);
  assert.equal(requests, 1);
  await wakeLock.release();
  assert.equal(releases, 1);
});

test("a wake lock request that finishes after stop is released immediately", async () => {
  let finishRequest: ((sentinel: { released: boolean; release(): Promise<void> }) => void) | undefined;
  let releases = 0;
  const wakeLock = createRecordingWakeLock({
    wakeLock: {
      request: () => new Promise((resolve) => {
        finishRequest = resolve;
      })
    }
  });

  const acquiring = wakeLock.acquire();
  await wakeLock.release();
  finishRequest?.({
    released: false,
    async release() {
      releases += 1;
      this.released = true;
    }
  });

  assert.equal(await acquiring, false);
  assert.equal(releases, 1);
});
