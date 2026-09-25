export const APP_VERSION = "2.4.2";

export const RELEASE_DATE = "2026-09-25";

export const RELEASE_DEVELOPER = "Team Chat";

export const RELEASE_NOTES = [
  "手写新增毛笔笔触，支持慢写变宽、快写收细、转弯滞后、账号级参数保存、全屏书写和扩大采样上限。",
  "手写调色盘选色后保持打开，只有点关闭按钮才收起；“显示纸张”和“光晕”合并到同一行。",
  "聊天附件不再限制上传文件大小，应用层和 VPS Nginx 请求体均取消大小上限。",
  "聊天媒体、聊天记录附件、资源管理和管理端备份/导出在预览或下载时显示实时进度，并支持取消。"
] as const;
