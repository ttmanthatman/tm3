export const APP_VERSION = "2.9.11";

export const RELEASE_DATE = "2026-10-19";

export const RELEASE_DEVELOPER = "Team Chat";

export const RELEASE_NOTES = [
  "修复 NAS 微信转发把已发出的短通知误判为发送失败、进而暂停整个队列的问题；发送前确认输入内容可见，发送后结合聊天局部变化和输入框清空验证结果，并允许画面延迟刷新。",
  "微信转发故障恢复后不再逐条补发积压消息，只发送一条“因转发故障，积压了XX条消息，请回聊天室查看”；积压计数在重试和重启后保留，恢复后的新消息正常转发。",
  "微信发送结果不确定时保存设备本机的故障截图与时间，并在管理页明确提示暂停状态和待确认消息编号，便于排查且避免重复发送。"
] as const;
