export const COMPOSER_LINE_HEIGHT = 22;
export const COMPOSER_VERTICAL_PADDING = 16;
export const COMPOSER_MAX_ROWS = 12;
export const COMPOSER_MIN_HEIGHT = COMPOSER_LINE_HEIGHT + COMPOSER_VERTICAL_PADDING;
export const COMPOSER_MAX_HEIGHT = COMPOSER_LINE_HEIGHT * COMPOSER_MAX_ROWS + COMPOSER_VERTICAL_PADDING;

export function composerHeightForContent(scrollHeight: number) {
  return Math.min(COMPOSER_MAX_HEIGHT, Math.max(COMPOSER_MIN_HEIGHT, Math.ceil(scrollHeight)));
}
