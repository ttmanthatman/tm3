export const APP_VERSION = "2.4.3";

export const RELEASE_DATE = "2026-09-25";

export const RELEASE_DEVELOPER = "Team Chat";

export const RELEASE_NOTES = [
  "手写毛笔增加自适应输入稳定、无方向点状起笔与停留按笔、独立角度惯性和基于曲率/停顿/减速的转锋判断；笔锋随首段运笔确定方向，转折轮廓更平滑，停笔不再自动回正。",
  "手机触屏的笔锋放大镜移到字格外左上方；当前字格新增一键清空。毛笔速度响应、笔头滞后及光晕参数改由管理员全局设置，个人仍可选择笔粗和是否启用光晕。"
] as const;
