import { computed, ref, watch, type ComputedRef, type Ref } from "vue";

export interface MusicSleepTimerRuntime {
  setInterval: (handler: () => void, delay: number) => number;
  clearInterval: (timer: number) => void;
  now: () => number;
}

interface UseMusicSleepTimerOptions {
  currentTrackId: Ref<number | null>;
  onStop: () => void;
  runtime?: MusicSleepTimerRuntime;
}

export type MusicSleepTimerKind = "off" | "minutes" | "tracks";

export type MusicSleepTimer = ReturnType<typeof useMusicSleepTimer>;

function browserSleepTimerRuntime(): MusicSleepTimerRuntime {
  return {
    setInterval: (handler, delay) => window.setInterval(handler, delay),
    clearInterval: (timer) => window.clearInterval(timer),
    now: () => Date.now()
  };
}

export function useMusicSleepTimer(options: UseMusicSleepTimerOptions) {
  const runtime = options.runtime || browserSleepTimerRuntime();
  const kind: Ref<MusicSleepTimerKind> = ref("off");
  const remainingMs = ref(0);
  const remainingTracks = ref(0);
  let deadline = 0;
  let tick: number | null = null;

  function clearTick() {
    if (tick === null) return;
    runtime.clearInterval(tick);
    tick = null;
  }

  function cancel() {
    clearTick();
    kind.value = "off";
    remainingMs.value = 0;
    remainingTracks.value = 0;
    deadline = 0;
  }

  function fire() {
    cancel();
    options.onStop();
  }

  function startMinutes(minutes: number) {
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    cancel();
    kind.value = "minutes";
    deadline = runtime.now() + Math.round(minutes) * 60_000;
    remainingMs.value = Math.max(0, deadline - runtime.now());
    tick = runtime.setInterval(() => {
      remainingMs.value = Math.max(0, deadline - runtime.now());
      if (remainingMs.value <= 0) fire();
    }, 1000);
  }

  function startTracks(count: number) {
    if (!Number.isFinite(count) || count <= 0) return;
    cancel();
    kind.value = "tracks";
    remainingTracks.value = Math.round(count);
  }

  watch(options.currentTrackId, (trackId, previousTrackId) => {
    if (kind.value !== "tracks") return;
    if (trackId == null || previousTrackId == null || trackId === previousTrackId) return;
    remainingTracks.value -= 1;
    if (remainingTracks.value <= 0) fire();
  });

  const label: ComputedRef<string> = computed(() => {
    if (kind.value === "minutes") {
      const totalSeconds = Math.ceil(remainingMs.value / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      return minutes > 0 ? `${minutes} 分 ${seconds} 秒后停止` : `${seconds} 秒后停止`;
    }
    if (kind.value === "tracks") return `还剩 ${Math.max(0, remainingTracks.value)} 首`;
    return "";
  });

  return {
    state: { kind, remainingMs, remainingTracks, label },
    controls: { startMinutes, startTracks, cancel }
  };
}
