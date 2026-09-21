export const APP_VERSION = "2.2.7";

export const RELEASE_DATE = "2026-09-21";

export const RELEASE_DEVELOPER = "Team Chat";

export const RELEASE_NOTES = [
  "修复 iPhone 滚动版式依赖章节 iframe 的 `touchmove` 导致控制栏无法显示的问题，改为根据连续阅读器外层原生滚动位置判断上下方向；同时兼容 WebKit 的沙箱事件限制，使脚注点按由阅读器接管并正常弹出。"
] as const;
