import type { AdminLoginLogKind } from "../../shared/types.js";

export type MusicProgressEventState = "started" | "progress" | "paused" | "changed" | "ended" | "error";

export type MusicProgressLogInput = {
  kind: AdminLoginLogKind;
  accountId: number;
  sessionId?: string | null;
  trackId?: number | null;
  playbackId?: string | null;
  appVersion?: string | null;
  latestVersion?: string | null;
  isLatestVersion?: boolean | null;
  state?: string | null;
  progressMs?: number | null;
  listenedMs?: number | null;
  durationMs?: number | null;
};

export type MusicProgressEvent = {
  accountId: number;
  sessionId?: string | null;
  trackId: number;
  playbackId: string;
  state: MusicProgressEventState;
  progressMs: number;
  listenedMs: number;
  durationMs: number;
  appVersion?: string | null;
  latestVersion?: string | null;
  isLatestVersion?: boolean | null;
};

type MusicProgressSession = {
  accountId: number;
  sessionId: string | null;
  trackId: number;
  playbackId: string;
  progressMs: number;
  listenedMs: number;
  durationMs: number;
  appVersion: string | null;
  latestVersion: string | null;
  isLatestVersion: boolean | null;
  timer: NodeJS.Timeout | null;
};

export type MusicProgressTrackerOptions = {
  write(input: MusicProgressLogInput): Promise<void>;
  idleMs?: number;
};

const TERMINAL_STATES: ReadonlySet<MusicProgressEventState> = new Set(["changed", "ended", "error"]);

export function createMusicProgressTracker(options: MusicProgressTrackerOptions) {
  const idleMs = options.idleMs ?? 60_000;
  const sessions = new Map<string, MusicProgressSession>();

  function clearSessionTimer(session: MusicProgressSession) {
    if (session.timer) clearTimeout(session.timer);
    session.timer = null;
  }

  function armIdleTimer(session: MusicProgressSession) {
    clearSessionTimer(session);
    session.timer = setTimeout(() => flush(session.playbackId, false), idleMs);
    session.timer.unref?.();
  }

  function flush(playbackId: string, finished: boolean) {
    const session = sessions.get(playbackId);
    if (!session) return Promise.resolve();
    sessions.delete(playbackId);
    clearSessionTimer(session);
    return options
      .write({
        kind: "music_progress",
        accountId: session.accountId,
        sessionId: session.sessionId,
        trackId: session.trackId,
        playbackId: session.playbackId,
        appVersion: session.appVersion,
        latestVersion: session.latestVersion,
        isLatestVersion: session.isLatestVersion,
        state: finished ? "ended" : "paused",
        progressMs: session.progressMs,
        listenedMs: session.listenedMs,
        durationMs: session.durationMs
      })
      .catch(() => undefined);
  }

  function record(event: MusicProgressEvent) {
    const existing = sessions.get(event.playbackId);
    const session: MusicProgressSession = existing || {
      accountId: event.accountId,
      sessionId: event.sessionId || null,
      trackId: event.trackId,
      playbackId: event.playbackId,
      progressMs: event.progressMs,
      listenedMs: event.listenedMs,
      durationMs: event.durationMs,
      appVersion: null,
      latestVersion: null,
      isLatestVersion: null,
      timer: null
    };
    session.progressMs = event.progressMs;
    session.durationMs = event.durationMs;
    session.listenedMs = Math.max(session.listenedMs, event.listenedMs);
    session.appVersion = event.appVersion || null;
    session.latestVersion = event.latestVersion || null;
    session.isLatestVersion = event.isLatestVersion ?? null;
    if (TERMINAL_STATES.has(event.state)) {
      sessions.set(event.playbackId, session);
      void flush(event.playbackId, event.state === "ended");
      return;
    }
    sessions.set(event.playbackId, session);
    armIdleTimer(session);
  }

  async function flushAll() {
    await Promise.all([...sessions.keys()].map((playbackId) => flush(playbackId, false)));
  }

  function dispose() {
    for (const session of sessions.values()) clearSessionTimer(session);
    sessions.clear();
  }

  return { record, flushAll, dispose };
}

export type MusicProgressTracker = ReturnType<typeof createMusicProgressTracker>;
