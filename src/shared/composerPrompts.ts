export const DEFAULT_COMPOSER_PROMPTS = ["分享下今天的恩典？"];

export const COMPOSER_PROMPT_MAX_COUNT = 50;
export const COMPOSER_PROMPT_MAX_LENGTH = 80;

export const COMPOSER_PROMPT_INTERVAL_MIN = 1;
export const COMPOSER_PROMPT_INTERVAL_MAX = 30;
export const DEFAULT_COMPOSER_PROMPT_INTERVAL = 3;

export const COMPOSER_PROMPT_ANIM_MIN = 0.3;
export const COMPOSER_PROMPT_ANIM_MAX = 5;
export const DEFAULT_COMPOSER_PROMPT_APPEAR = 1.2;
export const DEFAULT_COMPOSER_PROMPT_DISAPPEAR = 1.2;

export const COMPOSER_PROMPT_GAP_MIN = 1;
export const COMPOSER_PROMPT_GAP_MAX = 60;
export const DEFAULT_COMPOSER_PROMPT_GAP = 6;

export function cleanComposerPrompts(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const cleaned: string[] = [];
  for (const item of input) {
    if (typeof item !== "string") continue;
    const text = item.trim().slice(0, COMPOSER_PROMPT_MAX_LENGTH);
    if (text) cleaned.push(text);
    if (cleaned.length >= COMPOSER_PROMPT_MAX_COUNT) break;
  }
  return cleaned;
}

export function cleanComposerPromptIntervalSeconds(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) return DEFAULT_COMPOSER_PROMPT_INTERVAL;
  const clamped = Math.max(COMPOSER_PROMPT_INTERVAL_MIN, Math.min(COMPOSER_PROMPT_INTERVAL_MAX, parsed));
  return Math.round(clamped * 100) / 100;
}

function cleanAnimSeconds(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) return fallback;
  const clamped = Math.max(COMPOSER_PROMPT_ANIM_MIN, Math.min(COMPOSER_PROMPT_ANIM_MAX, parsed));
  return Math.round(clamped * 100) / 100;
}

export function cleanComposerPromptAppearSeconds(value: unknown): number {
  return cleanAnimSeconds(value, DEFAULT_COMPOSER_PROMPT_APPEAR);
}

export function cleanComposerPromptDisappearSeconds(value: unknown): number {
  return cleanAnimSeconds(value, DEFAULT_COMPOSER_PROMPT_DISAPPEAR);
}

export function cleanComposerPromptGapSeconds(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) return DEFAULT_COMPOSER_PROMPT_GAP;
  const clamped = Math.max(COMPOSER_PROMPT_GAP_MIN, Math.min(COMPOSER_PROMPT_GAP_MAX, parsed));
  return Math.round(clamped * 100) / 100;
}

export function mentionPromptText(name: string): string {
  return `${name}给你说话了，回应一下？`;
}

/**
 * Unacknowledged @mention names take priority over the admin prompt list.
 */
export function composerActivePrompts(prompts: string[], mentionNames: string[]): string[] {
  const names = mentionNames.map((name) => name.trim()).filter(Boolean);
  if (names.length > 0) return names.map(mentionPromptText);
  return prompts;
}

/**
 * Per-character timing for the letter-by-letter light-up animation: every
 * character fades with `duration` seconds and starts `index * stagger`
 * seconds late, so the whole text lights up in about `animSeconds`.
 */
export function composerPromptCharTiming(textLength: number, animSeconds: number): { stagger: number; duration: number } {
  const length = Math.max(1, Math.floor(textLength));
  const anim = cleanAnimSeconds(animSeconds, DEFAULT_COMPOSER_PROMPT_APPEAR);
  const stagger = anim / length;
  const duration = Math.min(0.5, Math.max(0.15, stagger * 1.2));
  return { stagger, duration };
}
