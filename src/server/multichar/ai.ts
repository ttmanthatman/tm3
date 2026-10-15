import { aiThinkingParameters, aiProviderHeaders, type AiProvider } from "../../shared/aiProviders.js";
import type { MulticharDeps } from "./types.js";

/** OpenAI 兼容 /chat/completions 响应中我们用到的字段；其余字段忽略。 */
interface ChatCompletionPayload {
  error?: { message?: unknown } | null;
  message?: unknown;
  choices?: { message?: { content?: unknown } }[];
}

export function createAiClient(deps: Pick<MulticharDeps, "loadAiSettings" | "decryptAiApiKey">) {
  async function callLlm(
    messages: { role: "system" | "user" | "assistant"; content: string }[],
    options?: { signal?: AbortSignal; provider?: AiProvider; model?: string; temperature?: number; maxTokens?: number; timeoutMs?: number; thinkingEnabled?: boolean }
  ): Promise<string> {
    const aiSettings = await deps.loadAiSettings();
    const provider = options?.provider || aiSettings.value.provider || "deepseek";
    const connection = aiSettings.value.providers?.find((item) => item.provider === provider);
    const apiKey = deps.decryptAiApiKey(aiSettings.providerKeys?.[provider] ?? aiSettings.encryptedApiKey);
    if (!apiKey) {
      throw new Error("AI 未启用或未配置 API Key");
    }
    const model = options?.model || connection?.model || aiSettings.value.model;
    const baseUrl = (connection?.baseUrl || aiSettings.value.baseUrl).replace(/\/+$/, "");
    const controller = new AbortController();
    const abort = () => controller.abort();
    options?.signal?.addEventListener("abort", abort, { once: true });
    if (options?.signal?.aborted) controller.abort();
    const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? 60_000);
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: aiProviderHeaders(provider, apiKey),
        body: JSON.stringify({
          model,
          messages,
          ...aiThinkingParameters(provider, options?.thinkingEnabled, model),
          stream: false,
          temperature: options?.temperature ?? 0.8,
          max_tokens: options?.maxTokens ?? 1024,
        }),
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as ChatCompletionPayload;
      if (!response.ok) {
        throw new Error(`AI 请求失败（HTTP ${response.status}）`);
      }
      const content = String(payload?.choices?.[0]?.message?.content || "").trim();
      if (!content) throw new Error("AI 返回空内容");
      return content;
    } finally {
      clearTimeout(timeout);
      options?.signal?.removeEventListener("abort", abort);
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
