export const APP_VERSION = "2.4.1";

export const RELEASE_DATE = "2026-09-23";

export const RELEASE_DEVELOPER = "Team Chat";

export const RELEASE_NOTES = [
  "手写画板新增 8 色调色盘，颜色按笔画保存并在发送预览、实时播放和历史重播中保留。",
  "手写编辑器移除重复的顶部成品区，改用底部预览删除整字；触控绘制改为增量渲染并合并草稿保存，减少长内容在手机上的重复 Canvas 绘制与 IndexedDB 写入。"
] as const;
