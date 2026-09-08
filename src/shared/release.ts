export const APP_VERSION = "1.17.1";

export const RELEASE_DATE = "2026-09-08";

export const RELEASE_DEVELOPER = "Team Chat";

export const RELEASE_NOTES = [
  "微信通知转发：修复管理页面的错误提示在故障恢复后一直不消失的问题（例如服务器重启瞬间的 502 会一直挂着），现在 NAS 恢复连接并成功心跳后旧错误会自动清除；驱动未就绪等真实状态不受影响。",
  "转发体验优化：转发成功后不再弹出浏览器提示，转发窗口内直接显示对号确认；转发的附件改为引用原文件（不再重复占用存储），原附件被删除后对应位置显示「转发附件已被删除」。"
] as const;
