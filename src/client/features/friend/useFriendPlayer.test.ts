import assert from "node:assert/strict";
import test from "node:test";
import type { FriendProgramDTO } from "../../../shared/types.js";
import { useFriendPlayer, type FriendPlayerRuntime } from "./useFriendPlayer.js";

class FakeAudio extends EventTarget {
  preload = "";
  currentTime = 30;
  duration = 120;
  paused = true;
  ended = false;
  volume = 1;
  dataset: Record<string, string> = {};
  src = "";
  playCalls = 0;

  async play() {
    this.playCalls += 1;
    this.paused = false;
    this.dispatchEvent(new Event("play"));
  }

  pause() {
    const wasPlaying = !this.paused;
    this.paused = true;
    if (wasPlaying) this.dispatchEvent(new Event("pause"));
  }

  load() {}

  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
}

function program(id: string): FriendProgramDTO {
  return {
    id,
    seriesId: `s${id}`,
    seriesTitle: `系列${id}`,
    title: `节目${id}`,
    date: "2026-07-01",
    audioUrl: `/api/friend/media?u=${encodeURIComponent(`https://txly2.net/ly/audio/${id}.mp3`)}`,
    imageUrl: `/api/friend/media?u=${encodeURIComponent(`https://txly2.net/images/${id}.png`)}`
  };
}

function createHarness(options: {
  programs?: FriendProgramDTO[];
  requestError?: boolean;
  onUserPlay?: () => void;
  onUserPause?: () => void;
  onEnded?: () => void;
} = {}) {
  const audio = new FakeAudio();
  const timeouts = new Map<number, () => void>();
  const frames = new Map<number, FrameRequestCallback>();
  let now = 0;
  let nextTimer = 1;
  const requests: string[] = [];

  const runtime: FriendPlayerRuntime = {
    createAudio: () => audio as unknown as HTMLAudioElement,
    now: () => now,
    setTimeout: (handler) => {
      const id = nextTimer++;
      timeouts.set(id, handler);
      return id;
    },
    clearTimeout: (id) => timeouts.delete(id),
    requestAnimationFrame: (handler) => {
      const id = nextTimer++;
      frames.set(id, handler);
      return id;
    },
    cancelAnimationFrame: (id) => frames.delete(id)
  };

  const player = useFriendPlayer({
    runtime,
    request: async <T>(path: string) => {
      requests.push(path);
      if (options.requestError) throw new Error("network down");
      return { programs: options.programs ?? [program("1"), program("2")] } as T;
    },
    streamUrl: (item) => `stream:${item.id}`,
    onUserPlay: options.onUserPlay,
    onUserPause: options.onUserPause,
    onEnded: options.onEnded
  });

  function advanceTime(ms: number) {
    now += ms;
    for (const [id, frame] of [...frames]) {
      frames.delete(id);
      frame(now);
    }
    for (const [id, handler] of [...timeouts]) {
      timeouts.delete(id);
      handler();
    }
  }

  return { player, audio, requests, advanceTime };
}

test("loadPrograms 拉取节目列表并处理失败", async () => {
  const { player, requests } = createHarness();
  await player.controls.loadPrograms();
  assert.deepEqual(requests, ["/api/friend/programs"]);
  assert.equal(player.state.programs.value.length, 2);
  assert.equal(player.state.listError.value, "");

  const failing = createHarness({ requestError: true });
  await failing.player.controls.loadPrograms();
  assert.equal(failing.player.state.listError.value, "节目单暂时无法获取，请稍后重试");
});

test("playProgram 触发 onUserPlay 并播放所选节目", async () => {
  let userPlays = 0;
  const { player, audio } = createHarness({ onUserPlay: () => { userPlays += 1; } });
  await player.controls.loadPrograms();
  const target = player.state.programs.value[0];
  await player.controls.playProgram(target);
  assert.equal(userPlays, 1);
  assert.equal(audio.src, "stream:1");
  assert.equal(player.state.currentProgramId.value, "1");
  assert.equal(player.state.playing.value, true);
});

test("duck 渐弱暂停并保留进度，resumeWithFade 渐强续播", async () => {
  const { player, audio, advanceTime } = createHarness();
  await player.controls.loadPrograms();
  await player.controls.playProgram(player.state.programs.value[0]);
  audio.currentTime = 42;

  player.controls.duck();
  assert.equal(player.state.playing.value, false);
  advanceTime(1000);
  assert.equal(audio.paused, true);
  assert.equal(audio.currentTime, 42, "挂起应保留播放进度");
  assert.equal(audio.volume, 1);

  await player.controls.resumeWithFade();
  assert.equal(audio.paused, false);
  assert.equal(player.state.playing.value, true);
  advanceTime(1000);
  assert.equal(audio.volume, 1);
});

test("toggleProgram 播放中再点为暂停并触发 onUserPause", async () => {
  let userPauses = 0;
  const { player, audio, advanceTime } = createHarness({ onUserPause: () => { userPauses += 1; } });
  await player.controls.loadPrograms();
  const target = player.state.programs.value[0];
  player.controls.toggleProgram(target);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(player.state.playing.value, true);

  player.controls.toggleProgram(target);
  assert.equal(userPauses, 1);
  advanceTime(1000);
  assert.equal(audio.paused, true);
});

test("自然播完触发 onEnded，播放失败显示中文错误", async () => {
  let ended = 0;
  const { player, audio } = createHarness({ onEnded: () => { ended += 1; } });
  await player.controls.loadPrograms();
  await player.controls.playProgram(player.state.programs.value[0]);
  audio.ended = true;
  audio.paused = true;
  audio.dispatchEvent(new Event("ended"));
  assert.equal(ended, 1);
  assert.equal(player.state.playing.value, false);

  const failing = createHarness();
  failing.audio.play = async () => {
    throw new DOMException("denied", "NotAllowedError");
  };
  await failing.player.controls.loadPrograms();
  await failing.player.controls.playProgram(failing.player.state.programs.value[0]);
  assert.equal(failing.player.state.error.value, "请再次点击播放");
});
