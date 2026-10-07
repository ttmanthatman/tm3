export const APP_VERSION = "2.5.8";

export const RELEASE_DATE = "2026-10-07";

export const RELEASE_DEVELOPER = "Team Chat";

export const RELEASE_NOTES = [
  "听歌、读圣经和输入状态提示完整滚过可见区域后再循环，离屏或后台时暂停动画。",
  "音乐播放减少重复下载，网络中断时有限重试并保留播放进度，避免切歌时旧播放请求干扰新歌曲。",
  "抄写消息提前加载笔迹，回放复用已绘制的字并分帧处理复杂笔画，按住左右拖动移出气泡仍可调整进度。"
] as const;
