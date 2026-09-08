export type SettingsTab = "account" | "appearance" | "bible" | "devices" | "notifications" | "release";

export const settingsTabMeta: Record<SettingsTab, { title: string; description: string }> = {
  account: { title: "账号", description: "管理头像、昵称、密码和账号" },
  appearance: { title: "外观", description: "选择舒服、清晰的聊天主题" },
  bible: { title: "经文显示", description: "控制经文弹出的阅读方式" },
  notifications: { title: "通知", description: "决定哪些消息需要提醒你" },
  devices: { title: "登录设备", description: "查看并退出已登录的设备" },
  release: { title: "关于", description: "版本信息与更新说明" }
};
