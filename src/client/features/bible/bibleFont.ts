// 圣经正文字号：范围与本地兜底存储键由工作区（加载/即时应用）与偏好面板（步进调节）共用。
export const BIBLE_FONT_MIN = 16;
export const BIBLE_FONT_MAX = 40;
export const BIBLE_FONT_DEFAULT = 20;

export function clampBibleFontSize(value: number) {
  if (!Number.isFinite(value)) return BIBLE_FONT_DEFAULT;
  return Math.min(BIBLE_FONT_MAX, Math.max(BIBLE_FONT_MIN, Math.round(value)));
}

export function bibleFontSizeStorageKey(accountId: number) {
  return `team-chat-bible-font-size:${accountId}`;
}
