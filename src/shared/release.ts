export const APP_VERSION = "2.9.2";

export const RELEASE_DATE = "2026-10-10";

export const RELEASE_DEVELOPER = "Team Chat";

export const RELEASE_NOTES = [
  "修正语音录制交互：录音中点击别处继续录音，再点麦克风或停止按钮才结束；停止后时长固定，录音面板保留等待发送或删除，删除后可点击麦克风或别处收起。",
  "未发送的录音在当前浏览器按账号保存为单份草稿，重新进入聊天室自动恢复；防止连续点击重复录制、旧回调恢复已删除录音，并修正 Chromium 编码与 WebKit 草稿存储兼容问题。",
  "调整圣经开合图标与笔记卡片宽度，修正聊天操作菜单的定位和窄屏滚动。"
] as const;
