export const APP_VERSION = "1.18.4";

export const RELEASE_DATE = "2026-09-18";

export const RELEASE_DEVELOPER = "Team Chat";

export const RELEASE_NOTES = [
  "恩典记录改为频道内卡片：输入框右侧「+」或「/恩典」都可打开记录面板，发送后留在当前频道，并按需出现该频道的「数算恩典」子入口；卡片改为梦幻彩虹配色。",
  "收藏夹下新增「恩典收藏」：自动收录自己发出的所有恩典卡，也会汇总自己收藏的他人恩典卡。",
  "语音消息支持转文字：语音气泡旁点击「转文字」即可在气泡下方显示识别文本（接入小米 MiMo-V2.5-ASR，识别结果全聊天室实时同步）。",
  "管理 → AI 设置新增「语音识别」配置页：可开关语音识别、配置 API Key、接口地址、模型与识别语种。"
] as const;
