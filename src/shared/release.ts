export const APP_VERSION = "1.14.4";

export const RELEASE_DATE = "2026-09-03";

export const RELEASE_DEVELOPER = "Team Chat";

export const RELEASE_NOTES = [
  "修复设置面板自动更新在部分服务器上失败的问题：服务器全局 git 配置（过期令牌、URL 重写）或网络干扰会让公开仓库的匿名访问被误认为需要登录，更新在“检查 GitHub 连接”一步失败；现在更新时会忽略这些干扰配置，git 通道不可用时会自动改用压缩包下载。"
] as const;
