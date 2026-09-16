export const APP_VERSION = "1.18.2";

export const RELEASE_DATE = "2026-09-16";

export const RELEASE_DEVELOPER = "Team Chat";

export const RELEASE_NOTES = [
  "弱网切换更省流：链接预览只加载当前屏幕可见消息的预览，快速切换频道时旧频道的预览请求会立即取消、不再占用网络；加载失败的预览会稍后自动重试，缓存有上限并在退出登录时清理。",
  "内部：新增弱网、弹窗键盘、移动端视口与性能基线的隔离浏览器测试（共 31 项），性能指标有了可重复的前后对比依据；新增消息发送 ACK 丢失后的幂等恢复协议设计文档（仅设计，尚未实现）。"
] as const;
