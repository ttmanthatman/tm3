export const APP_VERSION = "2.12.0";

export const RELEASE_DATE = "2026-10-24";

export const RELEASE_DEVELOPER = "Team Chat";

export const RELEASE_NOTES = [
  "Zoom 会议开始、结束后，所有公共聊天频道自动出现居中的蓝底白字系统通知，随聊天记录保存和滚动；点击“Zoom会议开始了”可直接进入会议，同一会议的重复通知不会生成重复消息。",
  "Zoom 开会状态通过签名事件自动同步；只有管理员可长按打开状态窗口，未开会时短按先确认再进入，状态无法确认时单独提示。"
] as const;
