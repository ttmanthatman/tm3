export const APP_VERSION = "2.5.9";

export const RELEASE_DATE = "2026-10-08";

export const RELEASE_DEVELOPER = "Team Chat";

export const RELEASE_NOTES = [
  "新增毛笔算法“真迹壹”，保留“峰回路转”和“石径斜”；笔锋尾部更细长流线，保持原有按下中心并去除转向时的侧向扭动。",
  "“真迹壹”支持输入停顿阈值（默认 200 毫秒）和转向倍率（默认 0.1）；停顿后的减速持续到抬笔，始终跟随最新运笔方向，参数随账号保存。",
  "运笔方向突变超过 135° 时固定尾尖，沿垂直于新轨迹的折线随运笔距离翻折，翻折扫过的边缘继续留下墨迹；实时书写、静态显示及回放保持一致。"
] as const;
