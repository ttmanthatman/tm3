export const APP_VERSION = "2.5.5";

export const RELEASE_DATE = "2026-10-05";

export const RELEASE_DEVELOPER = "Team Chat";

export const RELEASE_NOTES = [
  "修复进入含复杂手写画作的频道时长时间卡住的问题，保留历史笔迹、颜色及光晕外观。",
  "手写历史消息按可见区域分批绘制，切换频道、移出屏幕和后台停留时取消无效任务；静态笔迹重复出现时复用，回放只更新变化中的字。",
  "减少手写消息初始化、重复回放及结束时的重复计算，改善手机和桌面的频道切换响应。"
] as const;
