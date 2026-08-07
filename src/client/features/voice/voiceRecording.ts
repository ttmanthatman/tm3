export type VoiceRecordingStopReason = "user" | "discard" | "interrupted";

type VoiceRecorder = {
  state: string;
  start(): void;
  stop(): void;
};

export function createVoiceRecordingSession() {
  let stopReason: VoiceRecordingStopReason = "interrupted";

  return {
    start(recorder: VoiceRecorder) {
      stopReason = "interrupted";
      // WebKit has had long-recording failures when MediaRecorder is started
      // with a periodic timeslice. A single low-bitrate voice blob is small,
      // so collect it when the user stops instead.
      recorder.start();
    },
    stop(recorder: VoiceRecorder, reason: Exclude<VoiceRecordingStopReason, "interrupted">) {
      stopReason = reason;
      if (recorder.state !== "inactive") recorder.stop();
    },
    consumeStop() {
      const reason = stopReason;
      stopReason = "interrupted";
      return { reason, keepPreview: reason !== "discard" } as const;
    }
  };
}

type WakeLockSentinelLike = {
  released: boolean;
  release(): Promise<void>;
};

type WakeLockSource = {
  wakeLock?: {
    request(type: "screen"): Promise<WakeLockSentinelLike>;
  };
};

export function createRecordingWakeLock(source: WakeLockSource) {
  let sentinel: WakeLockSentinelLike | null = null;
  let pendingAcquire: Promise<boolean> | null = null;
  let requestVersion = 0;

  return {
    async acquire() {
      if (sentinel && !sentinel.released) return true;
      if (!source.wakeLock) return false;
      if (pendingAcquire) return pendingAcquire;
      const version = requestVersion;
      const request = (async () => {
        try {
          const acquired = await source.wakeLock!.request("screen");
          if (version !== requestVersion) {
            if (!acquired.released) await acquired.release().catch(() => undefined);
            return false;
          }
          sentinel = acquired;
          return true;
        } catch {
          sentinel = null;
          return false;
        }
      })();
      pendingAcquire = request;
      try {
        return await request;
      } finally {
        if (pendingAcquire === request) pendingAcquire = null;
      }
    },
    async release() {
      requestVersion += 1;
      pendingAcquire = null;
      const current = sentinel;
      sentinel = null;
      if (!current || current.released) return;
      try {
        await current.release();
      } catch {
        // The browser may release the lock first when the page is hidden.
      }
    }
  };
}

export type VoiceRecordingSession = ReturnType<typeof createVoiceRecordingSession>;
