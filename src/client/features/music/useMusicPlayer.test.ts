import assert from "node:assert/strict";
import test from "node:test";
import { computed, ref } from "vue";
import type { MusicPlaybackStateDTO, MusicTrackDTO } from "../../../shared/types.js";
import { useMusicPlayer, type MusicPlayerRuntime } from "./useMusicPlayer.js";

class FakeAudio extends EventTarget {
  preload = "";
  currentTime = 0;
  duration = 120;
  paused = true;
  seeking = false;
  readyState = 2;
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

function track(id: number, favorited = false): MusicTrackDTO {
  return {
    id,
    canManage: true,
    title: `Track ${id}`,
    fileName: `${id}.mp3`,
    fileSize: 1_000,
    createdAt: "2026-01-01T00:00:00.000Z",
    heat: 0,
    manualOrder: id,
    favorited,
    scorePages: [],
    lyrics: null
  };
}

function playbackState(
  trackId: number | null,
  playbackMode: MusicPlaybackStateDTO["playbackMode"] = "shuffle"
): MusicPlaybackStateDTO {
  return {
    sourceKind: "library",
    playlistId: null,
    trackId,
    progressMs: 0,
    playbackMode,
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function createHarness(input?: {
  tracks?: MusicTrackDTO[];
  random?: number;
  playbackState?: MusicPlaybackStateDTO | null;
  request?: <T>(path: string, options?: RequestInit) => Promise<T>;
}) {
  const tracks = ref(input?.tracks || [track(1), track(2), track(3)]);
  const playlists = ref([]);
  const selectedSourceKind = ref<"library" | "favorites" | "playlist">("library");
  const selectedPlaylistId = ref<number | null>(null);
  const scoreOpen = ref(false);
  const audio = new FakeAudio();
  const storageValues = new Map<string, string>();
  const intervals = new Map<number, () => void>();
  const timeouts = new Map<number, () => void>();
  const frames = new Map<number, FrameRequestCallback>();
  const pageHideListeners = new Set<() => void>();
  const visibilityListeners = new Set<() => void>();
  const mediaHandlers = new Map<string, (() => void) | null>();
  const requests: Array<{ path: string; options?: RequestInit }> = [];
  const listeningChanges: Array<number | null> = [];
  let now = 0;
  let nextTimer = 1;
  let visible = true;

  const request = input?.request || (async <T>(path: string, options?: RequestInit) => {
    requests.push({ path, options });
    if (path === "/api/music/playback-state" && !options) {
      return { state: input?.playbackState ?? null } as T;
    }
    if (path === "/api/music/playback-state") {
      const state = JSON.parse(String(options?.body || "{}")) as MusicPlaybackStateDTO;
      return { accepted: true, state } as T;
    }
    return {} as T;
  });

  const runtime: MusicPlayerRuntime = {
    createAudio: () => audio as unknown as HTMLAudioElement,
    storage: {
      getItem: (key) => storageValues.get(key) || null,
      setItem: (key, value) => storageValues.set(key, value)
    },
    now: () => now,
    random: () => input?.random ?? 0,
    randomUUID: () => "playback-id",
    setInterval: (handler) => {
      const id = nextTimer++;
      intervals.set(id, handler);
      return id;
    },
    clearInterval: (id) => intervals.delete(id),
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
    cancelAnimationFrame: (id) => frames.delete(id),
    mediaSession: {
      playbackState: "none",
      metadata: null,
      setActionHandler(action, handler) {
        mediaHandlers.set(action, handler);
      }
    },
    createMediaMetadata: (metadata) => metadata as MediaMetadata,
    listenPageHide: (handler) => {
      pageHideListeners.add(handler);
      return () => pageHideListeners.delete(handler);
    },
    listenVisibilityChange: (handler) => {
      visibilityListeners.add(handler);
      return () => visibilityListeners.delete(handler);
    },
    documentVisible: () => visible
  };

  const player = useMusicPlayer({
    tracks,
    libraryTracks: computed(() => tracks.value),
    favoriteTracks: computed(() => tracks.value.filter((item) => item.favorited)),
    playlists,
    selectedSourceKind,
    selectedPlaylistId,
    scoreOpen,
    request,
    runtime,
    streamUrl: (item) => `/stream/${item.id}`,
    primeTrackCache: async () => undefined,
    onListeningChanged: () => {
      listeningChanges.push(player.state.playing.value ? player.state.currentTrack.value?.id || null : null);
    }
  });

  return {
    player,
    tracks,
    audio,
    storageValues,
    intervals,
    timeouts,
    frames,
    pageHideListeners,
    visibilityListeners,
    mediaHandlers,
    requests,
    listeningChanges,
    setNow(value: number) {
      now = value;
    },
    setVisible(value: boolean) {
      visible = value;
    }
  };
}

async function activate(harness: ReturnType<typeof createHarness>, accountId = 1) {
  harness.player.controls.mount();
  await harness.player.controls.activateAccount(accountId);
}

test("next track follows the unchanged default shuffle rule", async () => {
  const harness = createHarness({ random: 0 });
  await activate(harness);
  harness.player.controls.selectTrack(harness.tracks.value[0]);

  await harness.player.controls.shiftTrack(1, false);

  assert.equal(harness.player.state.playbackMode.value, "shuffle");
  assert.equal(harness.player.state.currentTrack.value?.id, 2);
  harness.player.controls.dispose();
});

test("shuffle navigation keeps history for previous-track actions", async () => {
  const harness = createHarness({ random: 0 });
  await activate(harness);
  harness.player.controls.selectTrack(harness.tracks.value[0]);
  await harness.player.controls.shiftTrack(1, false);
  await harness.player.controls.shiftTrack(1, false);

  await harness.player.controls.shiftTrack(-1, false);

  assert.equal(harness.player.state.currentTrack.value?.id, 2);
  harness.player.controls.dispose();
});

test("single mode restarts the same track when audio ends", async () => {
  const harness = createHarness();
  await activate(harness);
  harness.player.controls.selectTrack(harness.tracks.value[0]);
  harness.player.controls.setPlaybackMode("single");
  const playCalls = harness.audio.playCalls;

  harness.audio.ended = true;
  harness.audio.dispatchEvent(new Event("ended"));
  await Promise.resolve();

  assert.equal(harness.player.state.currentTrack.value?.id, 1);
  assert.equal(harness.audio.currentTime, 0);
  assert.ok(harness.audio.playCalls > playCalls);
  harness.player.controls.dispose();
});

test("invalid current tracks fall back without selecting the removed track", async () => {
  const harness = createHarness({ random: 0 });
  await activate(harness);
  harness.player.controls.selectTrack(harness.tracks.value[1]);
  harness.tracks.value = [track(1), track(3)];

  harness.player.controls.reconcileTracks();

  assert.equal(harness.player.state.currentTrack.value?.id, 1);
  assert.equal(harness.audio.dataset.trackId, "1");
  harness.player.controls.dispose();
});

test("progress synchronization remains throttled to five seconds", async () => {
  const harness = createHarness();
  await activate(harness);
  harness.player.controls.selectTrack(harness.tracks.value[0]);
  await Promise.resolve();
  harness.requests.length = 0;

  harness.setNow(1_000);
  harness.audio.currentTime = 1;
  harness.audio.dispatchEvent(new Event("timeupdate"));
  harness.setNow(4_999);
  harness.audio.currentTime = 4.999;
  harness.audio.dispatchEvent(new Event("timeupdate"));
  harness.setNow(5_000);
  harness.audio.currentTime = 5;
  harness.audio.dispatchEvent(new Event("timeupdate"));
  await Promise.resolve();

  const progressStates = harness.requests
    .filter((call) => call.path.endsWith("/progress"))
    .map((call) => JSON.parse(String(call.options?.body || "{}")).state);
  assert.deepEqual(progressStates, ["progress"]);
  harness.player.controls.dispose();
});

test("dispose removes timers, page listeners, audio callbacks, and media handlers", async () => {
  const harness = createHarness();
  await activate(harness);
  harness.player.controls.selectTrack(harness.tracks.value[0]);
  await Promise.resolve();

  harness.player.controls.dispose();
  const requestsAfterDispose = harness.requests.length;
  const listeningAfterDispose = harness.listeningChanges.length;
  for (const handler of harness.intervals.values()) handler();
  for (const handler of harness.timeouts.values()) handler();
  for (const handler of harness.pageHideListeners) handler();
  for (const handler of harness.visibilityListeners) handler();
  harness.audio.dispatchEvent(new Event("timeupdate"));
  harness.audio.dispatchEvent(new Event("ended"));

  assert.equal(harness.intervals.size, 0);
  assert.equal(harness.timeouts.size, 0);
  assert.equal(harness.frames.size, 0);
  assert.equal(harness.pageHideListeners.size, 0);
  assert.equal(harness.visibilityListeners.size, 0);
  assert.equal(harness.requests.length, requestsAfterDispose);
  assert.equal(harness.listeningChanges.length, listeningAfterDispose);
  assert.ok([...harness.mediaHandlers.values()].every((handler) => handler === null));
});

test("account changes discard prior playback state and ignore stale responses", async () => {
  let resolveFirstAccount: (value: { state: MusicPlaybackStateDTO | null }) => void = () => {
    assert.fail("first account request was not started");
  };
  let accountRequest = 0;
  const request = async <T>(path: string, options?: RequestInit) => {
    if (path === "/api/music/playback-state" && !options) {
      accountRequest += 1;
      if (accountRequest === 1) {
        return await new Promise<T>((resolve) => {
          resolveFirstAccount = resolve as (value: { state: MusicPlaybackStateDTO | null }) => void;
        });
      }
      return { state: playbackState(3, "single") } as T;
    }
    if (path === "/api/music/playback-state") {
      return { accepted: true, state: JSON.parse(String(options?.body || "{}")) } as T;
    }
    return {} as T;
  };
  const harness = createHarness({ request });
  harness.player.controls.mount();
  const firstActivation = harness.player.controls.activateAccount(1);

  harness.player.controls.handleAccountChange(2);
  resolveFirstAccount({ state: playbackState(1, "playlist") });
  await firstActivation;

  assert.equal(harness.player.state.currentTrackId.value, null);
  assert.equal(harness.player.state.playbackMode.value, "shuffle");

  await harness.player.controls.activateAccount(2);
  assert.equal(harness.player.state.currentTrack.value?.id, 3);
  assert.equal(harness.player.state.playbackMode.value, "single");
  harness.player.controls.dispose();
});
