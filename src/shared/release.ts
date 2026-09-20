export const APP_VERSION = "2.2.1";

export const RELEASE_DATE = "2026-09-20";

export const RELEASE_DEVELOPER = "Team Chat";

export const RELEASE_NOTES = [
  "聊天语音和音频改为脱离消息行的持续流式播放：滚出可视区不会停止，意外中断或刷新后会从本机保存的位置续播。",
  "语音发送失败后把录音暂存在当前设备，可在原消息位置重试或移除；发送中的上传图标不再旋转。",
  "故事点赞和评论头像复用聊天室头像裁切，竖图不会再因固有比例撑高或错位。"
] as const;
