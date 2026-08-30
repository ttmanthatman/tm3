import { NEWEST_POSITION_THRESHOLD } from "./readPosition.js";

export type ChatReadAnchor =
  | { kind: "message"; messageId: number; offset: number; expiresAt: number; token: number }
  | { kind: "newest"; token: number };

type NewestViewportState = {
  distanceFromBottom: number;
  hasNewerMessages: boolean;
};

export function isChatViewportAtNewest(
  state: NewestViewportState,
  threshold = NEWEST_POSITION_THRESHOLD
) {
  return !state.hasNewerMessages
    && Number.isFinite(state.distanceFromBottom)
    && state.distanceFromBottom <= threshold;
}

export function newestChatReadAnchor(token: number): ChatReadAnchor {
  return { kind: "newest", token };
}

export function shouldApplyChatReadAnchor(
  scheduled: ChatReadAnchor,
  current: ChatReadAnchor | null,
  restoreToken: number,
  now = Date.now()
) {
  if (current !== scheduled || scheduled.token !== restoreToken) return false;
  return scheduled.kind === "newest" || scheduled.expiresAt >= now;
}

export function createChatScrollIntentTracker() {
  let followNewestAfterIdle = false;

  function note(state: NewestViewportState) {
    followNewestAfterIdle = isChatViewportAtNewest(state);
  }

  return {
    begin: note,
    noteScroll: note,
    shouldFollowNewestAfterIdle() {
      const result = followNewestAfterIdle;
      followNewestAfterIdle = false;
      return result;
    },
    reset() {
      followNewestAfterIdle = false;
    }
  };
}
