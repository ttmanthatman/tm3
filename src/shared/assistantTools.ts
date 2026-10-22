/** Shared user-facing entry points. Registering a feature makes it discoverable by assistants. */
export const ASSISTANT_FEATURES = [
  { id: "bible", label: "圣经", description: "查经、读经、听经、经文搜索、笔记和抄经" },
  { id: "books", label: "图书室", description: "找书、阅读、书签和读书笔记" },
  { id: "music", label: "歌曲", description: "歌曲、歌词、歌单和播放" },
  { id: "scores", label: "歌谱", description: "查找、分享和下载歌谱" },
  { id: "friend", label: "良友", description: "良友节目、分类、收听和下载" },
  { id: "search", label: "聊天记录", description: "查找聊天消息" },
  { id: "favorites", label: "收藏", description: "查看自己的消息收藏" },
  { id: "prayer", label: "代祷", description: "查看、发布和回应代祷" },
  { id: "grace", label: "恩典", description: "查看、分享恩典和见证" },
  { id: "stories", label: "故事", description: "阅读和分享故事" },
  { id: "handwriting", label: "手写", description: "手写消息和绘画" },
  { id: "chain", label: "接龙", description: "发起和参与接龙" },
  { id: "sermon", label: "讲道", description: "讲道阅读和研究工具" },
  { id: "members", label: "成员列表", description: "查看当前频道成员、提及和发起私聊" },
  { id: "channels", label: "频道列表", description: "浏览并切换可访问频道" },
  { id: "help", label: "使用说明", description: "聊天室使用说明" }
] as const;

export type AssistantFeatureId = typeof ASSISTANT_FEATURES[number]["id"];
export type AssistantFeatureAction = { feature: AssistantFeatureId; label: string };
export type AssistantToolDescriptor = { name: string; description: string; kind: "read" | "present"; input: Record<string, unknown> };
export type AssistantToolsSettingsDTO = { enabled: boolean; maxCalls: number; functions: AssistantToolDescriptor[] };

export function isAssistantFeatureId(value: unknown): value is AssistantFeatureId {
  return typeof value === "string" && ASSISTANT_FEATURES.some(feature => feature.id === value);
}

export function assistantFeatureActions(payload: unknown): AssistantFeatureAction[] {
  if (!payload || typeof payload !== "object" || !("assistantActions" in payload) || !Array.isArray(payload.assistantActions)) return [];
  return payload.assistantActions.slice(0, 8).flatMap((action: unknown) => {
    if (!action || typeof action !== "object" || !("feature" in action) || !isAssistantFeatureId(action.feature)) return [];
    const feature = ASSISTANT_FEATURES.find(feature => feature.id === action.feature)!;
    const label = "label" in action && typeof action.label === "string" ? action.label.trim().slice(0, 60) : feature.label;
    return [{ feature: feature.id, label: label || feature.label }];
  });
}
