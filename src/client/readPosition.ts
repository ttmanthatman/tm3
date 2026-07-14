export const NEWEST_READ_POSITION = "__newest__" as const;
export const NEWEST_POSITION_THRESHOLD = 220;

export type SavedReadPosition = {
  messageId: number | typeof NEWEST_READ_POSITION;
  offset: number;
  atBottom: boolean;
  scrollTop: number;
  savedAt: number;
};

export function newestPositionForSessionEntry(savedAt = Date.now()): SavedReadPosition {
  return {
    messageId: NEWEST_READ_POSITION,
    offset: 0,
    atBottom: true,
    scrollTop: 0,
    savedAt
  };
}

function finiteNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizeSavedReadPosition(value: unknown): SavedReadPosition | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<SavedReadPosition>;
  const messageId = raw.messageId === NEWEST_READ_POSITION ? NEWEST_READ_POSITION : finiteNumber(raw.messageId);
  if (messageId !== NEWEST_READ_POSITION && (!Number.isInteger(messageId) || messageId <= 0)) return null;
  return {
    messageId,
    offset: finiteNumber(raw.offset),
    atBottom: !!raw.atBottom,
    scrollTop: Math.max(0, finiteNumber(raw.scrollTop)),
    savedAt: Math.max(0, finiteNumber(raw.savedAt))
  };
}

export function shouldFollowMessageListChange(input: {
  restoring: boolean;
  loadingOlder: boolean;
  previousLength: number;
  length: number;
  nearBottom: boolean;
  latestIsMine: boolean;
}) {
  if (input.restoring || input.loadingOlder || input.length <= input.previousLength) return false;
  return input.previousLength === 0 || input.nearBottom || input.latestIsMine;
}

export function shouldRestoreNewestPosition(input: {
  atBottom: boolean;
  hasNewerMessages: boolean;
  distanceFromBottom: number;
}) {
  if (input.hasNewerMessages) return false;
  return input.atBottom || (Number.isFinite(input.distanceFromBottom) && input.distanceFromBottom <= NEWEST_POSITION_THRESHOLD);
}
