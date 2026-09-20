import assert from "node:assert/strict";
import test from "node:test";
import { createExclusiveAudio } from "./exclusiveAudio.js";
import { createMessageAudioPlayback } from "./messageAudioPlayback.js";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

class FakeAudio extends EventTarget {
  currentTime = 0;
  duration = 120;
  ended = false;
  paused = true;
  preload: HTMLMediaElement["preload"] = "";
  src = "";
  playCalls = 0;
  pauseCalls = 0;
  constructor(src: string) {
    super();
    this.src = src;
  }
  async play() {
    this.playCalls += 1;
    this.paused = false;
  }
  pause() {
    this.pauseCalls += 1;
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }
  setAttribute() {}
}

test("virtual-list unmount only detaches the UI and keeps message audio playing", async () => {
  const audios: FakeAudio[] = [];
  const manager = createMessageAudioPlayback({
    createAudio: (src) => {
      const audio = new FakeAudio(src);
      audios.push(audio);
      return audio;
    },
    exclusiveAudio: createExclusiveAudio(),
    storage: new MemoryStorage()
  });
  const unsubscribe = manager.subscribe(42, "/api/files/42", 120_000, () => undefined);

  await manager.toggle(42, "/api/files/42", 120_000);
  unsubscribe();

  assert.equal(audios[0]?.paused, false);
  assert.equal(audios[0]?.pauseCalls, 0);
  assert.equal(manager.snapshot(42, 120_000).playing, true);
  assert.equal(audios[0]?.preload, "metadata", "HTMLAudioElement should stream on demand instead of preloading the full file");
});

test("an interrupted message resumes from the last locally persisted position", async () => {
  const storage = new MemoryStorage();
  const firstAudios: FakeAudio[] = [];
  const first = createMessageAudioPlayback({
    createAudio: (src) => {
      const audio = new FakeAudio(src);
      firstAudios.push(audio);
      return audio;
    },
    exclusiveAudio: createExclusiveAudio(),
    storage
  });
  await first.toggle(7, "/api/files/7", 120_000);
  firstAudios[0]!.currentTime = 37.5;
  firstAudios[0]!.dispatchEvent(new Event("timeupdate"));
  firstAudios[0]!.dispatchEvent(new Event("error"));
  assert.equal(first.snapshot(7, 120_000).playing, false);

  const resumedAudios: FakeAudio[] = [];
  const resumed = createMessageAudioPlayback({
    createAudio: (src) => {
      const audio = new FakeAudio(src);
      resumedAudios.push(audio);
      return audio;
    },
    exclusiveAudio: createExclusiveAudio(),
    storage
  });
  await resumed.toggle(7, "/api/files/7", 120_000);

  assert.equal(resumedAudios[0]?.currentTime, 37.5);
  assert.equal(resumed.snapshot(7, 120_000).progress, 37.5 / 120);
});
