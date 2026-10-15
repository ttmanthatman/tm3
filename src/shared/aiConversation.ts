export interface AiConversationConfig {
  enabled: boolean;
  characterIds: number[];
  topic: string;
  maxMessages: number;
  maxContextChars: number;
  maxDurationSeconds: number;
  contextMessages: number;
  intervalSeconds: number;
}
export const DEFAULT_AI_CONVERSATION: AiConversationConfig = {
  enabled: false, characterIds: [], topic: "", maxMessages: 20,
  maxContextChars: 100000, maxDurationSeconds: 600, contextMessages: 20, intervalSeconds: 3
};
export interface AiConversationStatus {
  state: "idle" | "running" | "paused" | "stopped" | "completed" | "error";
  messages: number;
  contextChars: number;
  elapsedSeconds: number;
  reason: string;
}
