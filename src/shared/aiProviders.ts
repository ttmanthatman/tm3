export const AI_PROVIDERS = {
  deepseek: { name: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash" },
  bailian: { name: "阿里百炼", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  mimo: { name: "小米 MiMo", baseUrl: "https://api.xiaomimimo.com/v1", model: "mimo-v2.5" },
  volcengine: { name: "火山引擎 · Seed Character", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-seed-character-251128" }
} as const;
export type AiProvider = keyof typeof AI_PROVIDERS;
export interface AiProviderSettings { provider: AiProvider; baseUrl: string; model: string; apiKeyConfigured: boolean }
export function aiProviderHeaders(provider: AiProvider | undefined, apiKey: string): Record<string, string> {
  return { "Content-Type": "application/json", ...(provider === "mimo" ? { "api-key": apiKey } : { Authorization: `Bearer ${apiKey}` }) };
}
export function aiThinkingParameters(provider: AiProvider = "deepseek", enabled = false, model = "") {
  if (provider === "bailian") return { enable_thinking: enabled };
  if (provider === "volcengine" && model.includes("seed-character-251128")) return {};
  return { thinking: { type: enabled ? "enabled" : "disabled" } };
}
