import type { MulticharDeps } from "./types.js";

export function createAiClient(deps: MulticharDeps) {
  async function callLlm(
    messages: { role: "system" | "user" | "assistant"; content: string }[],
    options?: { model?: string; temperature?: number; maxTokens?: number; timeoutMs?: number; thinkingEnabled?: boolean }
  ): Promise<string> {
    const aiSettings = await deps.loadAiSettings();
    const apiKey = deps.decryptAiApiKey(aiSettings.encryptedApiKey);
    if (!aiSettings.value.enabled || !apiKey) {
      throw new Error("AI 未启用或未配置 API Key");
    }
    const model = options?.model || aiSettings.value.model;
    const baseUrl = aiSettings.value.baseUrl.replace(/\/+$/, "");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? 60_000);
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          thinking: { type: options?.thinkingEnabled ? "enabled" : "disabled" },
          stream: false,
          temperature: options?.temperature ?? 0.8,
          max_tokens: options?.maxTokens ?? 1024,
        }),
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as any;
      if (!response.ok) {
        const msg = payload?.error?.message || payload?.message || `AI HTTP ${response.status}`;
        throw new Error(String(msg));
      }
      const content = String(payload?.choices?.[0]?.message?.content || "").trim();
      if (!content) throw new Error("AI 返回空内容");
      return content;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function callUrgeModel(
    systemPrompt: string,
    userPrompt: string,
    model?: string
  ): Promise<string> {
    return callLlm(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { model, temperature: 0.3, maxTokens: 256, timeoutMs: 15_000 }
    );
  }

  async function callImpressionModel(
    systemPrompt: string,
    userPrompt: string,
    model?: string
  ): Promise<string> {
    return callLlm(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { model, temperature: 0.4, maxTokens: 512, timeoutMs: 20_000 }
    );
  }

  async function callMainModel(
    systemPrompt: string,
    userPrompt: string,
    model?: string,
    thinkingEnabled?: boolean
  ): Promise<string> {
    return callLlm(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { model, temperature: 0.85, maxTokens: 1024, timeoutMs: 60_000, thinkingEnabled }
    );
  }

  return { callLlm, callUrgeModel, callImpressionModel, callMainModel };
}

export type AiClient = ReturnType<typeof createAiClient>;
