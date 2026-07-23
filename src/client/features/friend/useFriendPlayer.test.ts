import assert from "node:assert/strict";
import test from "node:test";
import type { FriendCategoryDTO, FriendPlaybackDTO, FriendProgramDTO } from "../../../shared/types.js";
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
  categories?: FriendCategoryDTO[];
  seriesPrograms?: FriendProgramDTO[];
  history?: FriendPlaybackDTO[];
  requestError?: boolean;
  onUserPlay?: () => void;
  onUserPause?: () => void;
  onEnded?: () => void;
  onListeningChanged?: (program: FriendProgramDTO | null) => void;
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
      if (path === "/api/friend/history") return { history: options.history ?? [] } as T;
      if (path === "/api/friend/categories") {
        return {
          categories: options.categories ?? [{
            id: "6",
            title: "生活智慧",
            series: [{ id: "2", alias: "bc", title: "书香园地", description: "陪你读好书" }]
          }]
        } as T;
      }
      if (path.startsWith("/api/friend/series/")) {
        return { programs: options.seriesPrograms ?? [program("9")] } as T;
      }
      if (path.startsWith("/api/friend/playback/")) return { success: true } as T;
      return { programs: options.programs ?? [program("1"), program("2")] } as T;
    },
    streamUrl: (item) => `stream:${item.id}`,
    onUserPlay: options.onUserPlay,
    onUserPause: options.onUserPause,
    onEnded: options.onEnded,
    onListeningChanged: options.onListeningChanged
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

/** 模拟自然收听：以小步前进触发 timeupdate，累计真实收听时长 */
function simulateListen(audio: FakeAudio, seconds: number) {
  const steps = Math.round(seconds / 0.5);
  for (let index = 0; index < steps; index += 1) {
    audio.currentTime += 0.5;
    audio.dispatchEvent(new Event("timeupdate"));
  }
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

test("loadCategories 拉取分类并处理失败", async () => {
  const { player, requests } = createHarness();
  await player.controls.loadCategories();
  assert.deepEqual(requests, ["/api/friend/categories"]);
  assert.equal(player.state.categories.value.length, 1);
  assert.equal(player.state.categories.value[0].series[0].alias, "bc");
  assert.equal(player.state.categoriesError.value, "");

  const failing = createHarness({ requestError: true });
  await failing.player.controls.loadCategories();
  assert.equal(failing.player.state.categoriesError.value, "节目分类暂时无法获取，请稍后重试");
});

test("openSeries 加载系列节目，closeSeries 清空", async () => {
  const { player, requests } = createHarness();
  const series = { id: "2", alias: "bc", title: "书香园地" };
  await player.controls.openSeries(series);
  assert.deepEqual(requests, ["/api/friend/series/bc"]);
  assert.equal(player.state.activeSeries.value?.alias, "bc");
  assert.equal(player.state.seriesPrograms.value.length, 1);
  assert.equal(player.state.seriesPrograms.value[0].id, "9");

  player.controls.closeSeries();
  assert.equal(player.state.activeSeries.value, null);
  assert.equal(player.state.seriesPrograms.value.length, 0);
});

test("系列节目播放后 currentProgram 仍可解析并支持挂起续播", async () => {
  const { player, audio, advanceTime } = createHarness();
  await player.controls.openSeries({ id: "2", alias: "bc", title: "书香园地" });
  const target = player.state.seriesPrograms.value[0];
  await player.controls.playProgram(target);
  assert.equal(player.state.currentProgram.value?.id, "9");
  assert.equal(audio.src, "stream:9");

  player.controls.duck();
  advanceTime(1000);
  assert.equal(audio.paused, true);
  await player.controls.resumeWithFade();
  assert.equal(player.state.playing.value, true);
});

test("playRandom 从今日节目随机播放，已在播放时不打断", async () => {
  const { player, audio } = createHarness();
  await player.controls.playRandom();
  assert.equal(player.state.playing.value, true);
  assert.ok(["stream:1", "stream:2"].includes(audio.src), `随机应从今日节目选择，实际 ${audio.src}`);
  const firstPlayCalls = audio.playCalls;

  await player.controls.playRandom();
  assert.equal(audio.playCalls, firstPlayCalls, "播放中再次随机不应重新开始");
});

test("收听满 10 秒才写入收听记录，自动播放同样记录", async () => {
  const { player, audio, requests, advanceTime } = createHarness();
  await player.controls.playRandom();
  assert.equal(player.state.playing.value, true);
  const currentId = player.state.currentProgramId.value;

  simulateListen(audio, 6);
  advanceTime(10_000);
  assert.equal(requests.some((path) => path.startsWith("/api/friend/playback/")), false, "收听不足 10 秒不应上报");

  simulateListen(audio, 5);
  advanceTime(10_000);
  assert.ok(requests.includes(`/api/friend/playback/${currentId}`), "自动播放累计满 10 秒也应写入收听记录");
});

test("主动点播不足 10 秒不记录，累计满 10 秒后上报", async () => {
  const { player, audio, requests } = createHarness();
  await player.controls.loadPrograms();
  const target = player.state.programs.value[0];
  await player.controls.playProgram(target);

  simulateListen(audio, 4);
  player.controls.pause();
  assert.equal(requests.some((path) => path.startsWith("/api/friend/playback/")), false, "点播不足 10 秒不应上报");

  player.controls.toggleProgram(target);
  await new Promise((resolve) => setImmediate(resolve));
  simulateListen(audio, 7);
  player.controls.pause();
  assert.ok(requests.includes("/api/friend/playback/1"), "暂停续播累计满 10 秒应上报进度");
});

test("播放与暂停触发 onListeningChanged，播放中定时上报进度", async () => {
  const events: Array<string | null> = [];
  const { player, audio, requests, advanceTime } = createHarness({
    onListeningChanged: (program) => events.push(program ? program.id : null)
  });
  await player.controls.loadPrograms();
  await player.controls.playProgram(player.state.programs.value[0]);
  assert.deepEqual(events, ["1"]);
  assert.equal(requests.includes("/api/friend/playback/1"), false, "开始播放未满 10 秒不应上报");

  simulateListen(audio, 11);
  advanceTime(10_000);
  assert.ok(requests.includes("/api/friend/playback/1"), "累计满 10 秒后应上报进度");

  advanceTime(10_000);
  assert.equal(requests.filter((path) => path === "/api/friend/playback/1").length >= 2, true, "播放中应定时续报进度");

  player.controls.pause();
  assert.deepEqual(events, ["1", null]);
});

test("有收听记录时从上次进度续播", async () => {
  const history: FriendPlaybackDTO[] = [{
    programId: "2",
    seriesTitle: "系列2",
    title: "节目2",
    audioUrl: "/api/friend/media?u=x",
    progressMs: 61_000,
    durationMs: 120_000,
    playedAt: "2026-07-22T01:00:00.000Z"
  }];
  const { player, audio } = createHarness({ history });
  await player.controls.loadHistory();
  assert.equal(player.state.history.value.length, 1);
  await player.controls.loadPrograms();
  await player.controls.playProgram(player.state.programs.value[1]);
  assert.equal(audio.currentTime, 61, "应从历史进度续播");
});

test("resetHistory 清空收听记录", async () => {
  const history: FriendPlaybackDTO[] = [{
    programId: "1",
    seriesTitle: "系列1",
    title: "节目1",
    audioUrl: "/api/friend/media?u=x",
    progressMs: 1_000,
    durationMs: 120_000,
    playedAt: "2026-07-22T01:00:00.000Z"
  }];
  const { player } = createHarness({ history });
  await player.controls.loadHistory();
  assert.equal(player.state.history.value.length, 1);
  player.controls.resetHistory();
  assert.equal(player.state.history.value.length, 0);
});
