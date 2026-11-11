export const APP_VERSION = "2.15.0";

export const RELEASE_DATE = "2026-11-11";

export const RELEASE_DEVELOPER = "Team Chat";

export const RELEASE_NOTES = [
  "微信转发自动更新前清理过期构建，保留当前版本、最近两个可回退版本及自定义修复目录，避免磁盘持续增长影响转发。",
  "新增群日历，入口位于聊天室顶栏；支持仅自己、指定成员和全群可见，成员管理自己的日程，管理员可管理本群所有日程。",
  "日历支持重复安排、多个提醒时间及持久化私密提醒框，提醒框在分屏和阅读全屏时仍可操作；可选由管理员指定的虚拟角色发送普通群消息或接龙提醒，默认使用“日历”角色。",
  "电子书收藏摘录支持彩色高亮。"
] as const;
