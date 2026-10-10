import assert from "node:assert/strict";
import test from "node:test";
import { effectScope, ref } from "vue";
import type { VoiceDraft, VoiceDraftStorage } from "./voiceDrafts";
import { useVoiceRecording } from "./useVoiceRecording";

function harness(t: test.TestContext, draftStorage?: VoiceDraftStorage, accountId?: () => number | null) {
  let now = 0;
  let resolveStream!: (stream: MediaStream) => void;
  let requests = 0;
  const tracks = [{ stop() {} }];
  const stream = { getTracks: () => tracks } as unknown as MediaStream;
  const timers = new Map<number, () => void>();
  const recorders: Recorder[] = [];
  class Recorder {
    static isTypeSupported() { return true; }
    state = "inactive";
    mimeType = "audio/mp4";
    onstop: (() => void) | null = null;
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(_stream: MediaStream, options: MediaRecorderOptions) {
      assert.equal(options.mimeType, "audio/mp4", "let the browser choose its working MP4 codec");
      recorders.push(this);
    }
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; }
    finish() { this.ondataavailable?.({ data: new Blob(["voice"]) }); this.onstop?.(); }
  }
  t.mock.method(Date, "now", () => now);
  t.mock.method(URL, "createObjectURL", () => "blob:voice");
  t.mock.method(URL, "revokeObjectURL", () => undefined);
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const oldRecorder = Object.getOwnPropertyDescriptor(globalThis, "MediaRecorder");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    addEventListener() {}, removeEventListener() {}, MediaRecorder: Recorder, setInterval: (fn: () => void) => { const id = timers.size + 1; timers.set(id, fn); return id; }, clearInterval: (id: number) => timers.delete(id)
  } });
  Object.defineProperty(globalThis, "MediaRecorder", { configurable: true, value: Recorder });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: { getUserMedia: () => { requests++; return new Promise<MediaStream>((resolve) => { resolveStream = resolve; }); } } } });
  const scope = effectScope();
  const panel = ref<"voice" | "more" | null>("voice");
  const voice = scope.run(() => useVoiceRecording({ draftStorage, accountId, composerPanel: panel, pushPendingVoiceMessage: () => 0, uploadFile: async () => ({ success: true, duplicate: false, skipped: false }) }))!;
  t.after(() => {
    voice.disposeRecording(); scope.stop();
    for (const [key, old] of [["window", oldWindow], ["navigator", oldNavigator], ["MediaRecorder", oldRecorder]] as const) {
      if (old) Object.defineProperty(globalThis, key, old); else Reflect.deleteProperty(globalThis, key);
    }
  });
  return { scope, voice, panel, recorders, requests: () => requests, resolve: () => resolveStream(stream), tick: (ms: number) => { now = ms; for (const fn of timers.values()) fn(); } };
}

test("a rapid double start acquires only one microphone and recorder", async (t) => {
  const h = harness(t);
  const first = h.voice.startRecording();
  void h.voice.startRecording();
  assert.equal(h.requests(), 1);
  h.resolve(); await first;
  assert.equal(h.recorders.length, 1);
});

test("stopping freezes duration before the asynchronous recorder stop event", async (t) => {
  const h = harness(t);
  const start = h.voice.startRecording(); h.resolve(); await start;
  h.tick(1000); h.voice.stopRecording(); h.tick(7000);
  assert.equal(h.voice.recordingDuration.value, 1000);
  h.recorders[0]!.finish();
  assert.equal(h.voice.audioPreviewDurationMs.value, 1000);
});

test("outside dismissal keeps recording and stopped preview visible", async (t) => {
  const h = harness(t);
  const start = h.voice.startRecording(); h.resolve(); await start;
  h.panel.value = null;
  assert.equal(h.panel.value, "voice");
  assert.equal(h.recorders[0]!.state, "recording");
  h.voice.stopRecording(); h.recorders[0]!.finish(); h.panel.value = null;
  assert.equal(h.panel.value, "voice");
  h.voice.resetRecording(); h.panel.value = null;
  assert.equal(h.panel.value, null);
});

async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function memoryStorage() {
  const records = new Map<number, VoiceDraft>();
  const storage: VoiceDraftStorage = {
    load: async (id) => records.get(id),
    save: async (draft) => { records.set(draft.accountId, draft); },
    delete: async (id) => { records.delete(id); }
  };
  return { records, storage };
}

test("a cancelled permission request cannot create a recorder later", async (t) => {
  const h = harness(t);
  const start = h.voice.startRecording();
  h.voice.resetRecording(); h.resolve(); await start;
  assert.equal(h.recorders.length, 0);
  assert.equal(h.voice.isRecording.value, false);
});

test("an existing preview cannot be replaced by another recording", async (t) => {
  const h = harness(t);
  const start = h.voice.startRecording(); h.resolve(); await start;
  h.voice.stopRecording(); h.recorders[0]!.finish();
  const file = h.voice.audioFile.value;
  await h.voice.startRecording();
  assert.equal(h.requests(), 1);
  assert.equal(h.voice.audioFile.value, file);
});

test("a stopped draft survives leaving, restores for its account, and deletes without resurrection", async (t) => {
  const memory = memoryStorage();
  const account = ref<number | null>(3);
  const h = harness(t, memory.storage, () => account.value);
  await flush();
  const start = h.voice.startRecording(); h.resolve(); await start;
  h.tick(2400); h.voice.stopRecording(); h.recorders[0]!.finish();
  await flush();
  assert.equal(memory.records.size, 1);
  assert.equal(memory.records.get(3)?.durationMs, 2400);
  const original = await h.voice.audioFile.value!.text();
  // Losing the mounted composer releases resources but keeps the stored file.
  h.voice.disposeRecording(); await flush();
  assert.equal(memory.records.size, 1);
  const panel = ref<"voice" | "more" | null>(null);
  const reopened = h.scope.run(() => useVoiceRecording({ composerPanel: panel, accountId: () => account.value, draftStorage: memory.storage, pushPendingVoiceMessage: () => 0, uploadFile: async () => ({ success: true, duplicate: false, skipped: false }) }))!;
  await flush();
  assert.equal(panel.value, "voice");
  assert.equal(await reopened.audioFile.value!.text(), original);
  assert.equal(reopened.recordingDuration.value, 2400);
  assert.equal(reopened.isRecording.value, false);
  account.value = 4; await flush();
  assert.equal(reopened.audioFile.value, null);
  account.value = 3; await flush();
  assert.ok(reopened.audioFile.value);
  reopened.resetRecording(); await flush();
  assert.equal(memory.records.size, 0);
  account.value = 4; account.value = 3; await flush();
  assert.equal(reopened.audioFile.value, null);
});

test("deleting while waveform decoding is pending cannot resurrect the draft", async (t) => {
  const memory = memoryStorage();
  const h = harness(t, memory.storage, () => 3);
  await flush();
  let finishDecode!: (buffer: { duration: number; getChannelData: () => Float32Array }) => void;
  window.AudioContext = class {
    decodeAudioData() { return new Promise((resolve) => { finishDecode = resolve; }); }
    async close() {}
  } as unknown as typeof AudioContext;
  const start = h.voice.startRecording(); h.resolve(); await start;
  h.tick(1000); h.voice.stopRecording(); h.recorders[0]!.finish();
  await flush();
  h.voice.resetRecording();
  finishDecode({ duration: 8, getChannelData: () => new Float32Array([0.3, 0.8]) });
  await flush();
  assert.equal(memory.records.size, 0);
  assert.equal(h.voice.audioFile.value, null);
  assert.equal(h.voice.audioPreviewDurationMs.value, 0);
});


test("storage failure is visible while the original preview remains available", async (t) => {
  const storage: VoiceDraftStorage = {
    load: async () => undefined,
    save: async () => { throw new Error("quota exceeded"); },
    delete: async () => undefined
  };
  const h = harness(t, storage, () => 3); await flush();
  const start = h.voice.startRecording(); h.resolve(); await start;
  h.tick(1000); h.voice.stopRecording(); h.recorders[0]!.finish(); await flush();
  assert.ok(h.voice.audioFile.value);
  assert.match(h.voice.recordingNotice.value, /quota exceeded/);
});


test("late audio metadata cannot change the duration frozen by the stop button", async (t) => {
  const h = harness(t);
  const start = h.voice.startRecording(); h.resolve(); await start;
  h.tick(1200); h.voice.stopRecording(); h.recorders[0]!.finish(); await flush();
  h.voice.previewAudioEl.value = { duration: 2.4, pause() {} } as unknown as HTMLAudioElement;
  h.voice.syncPreviewMetadata();
  assert.equal(h.voice.audioPreviewDurationMs.value, 1200);
  assert.equal(h.voice.recordingDuration.value, 1200);
});
