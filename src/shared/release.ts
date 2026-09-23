export const APP_VERSION = "2.4.0";

export const RELEASE_DATE = "2026-09-23";

export const RELEASE_DEVELOPER = "Team Chat";

export const RELEASE_NOTES = [
  "新增逐字手写消息：一次写一字并手动完成字格，支持撤销单笔、删除整字、关闭后恢复草稿，以及发送前逐笔预览。",
  "手写消息在聊天和收藏中按书写顺序播放；实时新消息可见时自动播放一次，历史与收藏保持静态并可手动重播。",
  "引用、推送、频道预览和微信读取统一显示 `[手写消息]` 标签；首版继续不支持转发手写笔迹。"
] as const;
