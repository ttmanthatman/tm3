import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { AiSettingsDTO } from "../shared/types.js";

export const AI_RELATED_VERSES_KIND = "prayer_related_verses";
export const BIBLE_TOPIC_SEARCH_PROMPT = [
  "你根据用户输入的主题推荐圣经经文出处。",
  "只输出 8 个真实存在的经文出处，每行一个。",
  "可以输出单节或连续几节，但不要输出整章。",
  "不要输出经文正文、解释、标题、序号或其他文字。",
  "如果不确定出处是否存在，不要输出。"
].join("\n");
export const DEFAULT_AI_PROMPT_COMMAND = [
  "你只根据用户代祷信息，推荐 3 个可能相关的圣经经文出处。",
  "只输出经文出处，每行一个。",
  "不要输出完整经文。",
  "不要解释。",
  "不要祷告文。",
  "不要评价代祷发起人。",
  "不要替代牧养辅导。",
  "如果不确定出处是否存在，不要输出。",
  "尽量避开已推荐过的出处。"
].join("\n");
export const DEFAULT_AI_SETTINGS: AiSettingsDTO = {
  enabled: true,
  apiKeyConfigured: false,
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  promptCommand: DEFAULT_AI_PROMPT_COMMAND,
  cardCooldownSeconds: 30,
  userLimitPerMinute: 3,
  maxSuccessPerMessage: 7
};
export const WHY_ASSISTANT_USERNAME = "why_assistant";
export const WHY_ASSISTANT_NAME = "为什么助手";
export const QUESTION_ASSISTANT_USERNAME = "ai_slmm";
export const QUESTION_ASSISTANT_NAME = "ai_slmm";
export const DEFAULT_QUESTION_ASSISTANT_CONTEXT_TURNS = 10;
export const DEFAULT_QUESTION_ASSISTANT_CONTEXT_WINDOW_MINUTES = 10;
export const DEFAULT_WHY_ASSISTANT_PROMPT = [
  "你是“为什么助手”，是严格的查经和思考引导师，不是答案机。",
  "默认用中文短答。你要用问题引导用户观察、查证、祷告和找真实弟兄姐妹交通。",
  "不要直接给解经结论、神学定论或人生答案；事实型问题可以直接回答并给查证路径。",
  "查经/知识/思辨类问题要像老师批改作业一样严格：指出敷衍，要求用户回到文本、列观察、区分事实和解释。",
  "情绪、关系、创伤、婚恋、家庭痛苦类问题要收起严格语气，鼓励用户找真实可信的弟兄姐妹、带领者同行祷告。",
  "自伤或危险信号优先安全支持，不继续查经或神学分析。",
  "如果提供背景资料，优先英文资料，并标明出处；无法核验的资料要标为待查证。",
  "每次最多输出：一句对当前进度的判断、2-3 个下一步问题、必要时 1-2 条带出处的背景资料。"
].join("\n");
export const DEFAULT_QUESTION_ASSISTANT_PROMPT = [
  "你是聊天室里的 AI 助手 ai_slmm。",
  "当有人在普通聊天里发出问题时，你会收到这条消息。",
  "默认用中文回复，语气自然、简短、像群聊里认真帮忙的人。",
  "优先直接回应用户问的内容；如果信息不足，先问一个必要的澄清问题。",
  "不要编造事实；不确定时要说明不确定，并给出可查证路径。",
  "不要重复用户原话，不要自称大型语言模型。"
].join("\n");
export const DEFAULT_QUESTION_ASSISTANT_JUDGE_PROMPT = [
  "你是 ai_slmm 的弱激活判断体，只判断当前用户发言是否应该交给 ai_slmm 回复。",
  "如果当前发言延续上一次强激活问题、继续追问、补充信息、纠正 ai_slmm、或明显是在和 ai_slmm 对话，输出 yes。",
  "如果当前发言已经换话题、明显是在和其他人说话、只是群聊闲谈、通知、寒暄、表态或不需要 ai_slmm 参与，输出 no。",
  "只输出 yes 或 no，不要解释。"
].join("\n");
export const AI_ROLE_USERNAMES = new Set([WHY_ASSISTANT_USERNAME, QUESTION_ASSISTANT_USERNAME]);
const bibleTopicSearchWindows = new Map<number, number[]>();

export function clampInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export function cleanAiError(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 1000);
  return String(error || "AI request failed").slice(0, 1000);
}

export function parseAiVerseReferences(input: string, limit = 3) {
  const seen = new Set<string>();
  const references: string[] = [];
  for (const rawLine of input.split(/\n|;|；/g)) {
    const cleaned = rawLine
      .replace(/^\s*(?:[-*•]\s*|\d+[.、]\s*)/, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[。.!！]+$/g, "");
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    references.push(cleaned);
    if (references.length >= limit) break;
  }
  return references;
}

export function bibleTopicSearchAllowed(accountId: number, limit: number) {
  const cutoff = Date.now() - 60_000;
  const recent = (bibleTopicSearchWindows.get(accountId) || []).filter((timestamp) => timestamp >= cutoff);
  if (recent.length >= limit) {
    bibleTopicSearchWindows.set(accountId, recent);
    return false;
  }
  recent.push(Date.now());
  bibleTopicSearchWindows.set(accountId, recent);
  return true;
}

export function aiConfigurationMessage(auth: { isAdmin: boolean }) {
  return auth.isAdmin ? "AI 经文建议尚未配置，请前往 /ai-settings 填写 API Key。" : "暂时还不能生成经文建议，请稍后再试。";
}

export type AiSettingsStore = ReturnType<typeof createAiSettingsStore>;

export function createAiSettingsStore(deps: { prisma: PrismaClient; secret: string }) {
  const { prisma, secret } = deps;
  let aiSettingsCache: { value: AiSettingsDTO; encryptedApiKey: string; loadedAt: number } | null = null;

  function aiEncryptionKey() {
    return crypto.createHash("sha256").update(secret).digest();
  }

  function encryptAiApiKey(value: string) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", aiEncryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":");
  }

  function decryptAiApiKey(value: string) {
    if (!value) return "";
    try {
      const [version, iv, tag, encrypted] = value.split(":");
      if (version !== "v1" || !iv || !tag || !encrypted) return "";
      const decipher = crypto.createDecipheriv("aes-256-gcm", aiEncryptionKey(), Buffer.from(iv, "base64url"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
    } catch {
      return "";
    }
  }

  async function loadAiSettings(force = false) {
    if (!force && aiSettingsCache && Date.now() - aiSettingsCache.loadedAt < 5000) return aiSettingsCache;
    const rows = await prisma.setting.findMany({
      where: {
        key: {
          in: [
            "aiDeepSeekApiKeyEncrypted",
            "aiRelatedVersesEnabled",
            "aiRelatedVersesPromptCommand",
            "aiRelatedVersesCardCooldownSeconds",
            "aiRelatedVersesUserLimitPerMinute",
            "aiRelatedVersesMaxSuccessPerMessage"
          ]
        }
      }
    });
    const settings = new Map(rows.map((row) => [row.key, row.value]));
    const encryptedApiKey = settings.get("aiDeepSeekApiKeyEncrypted") || "";
    const value: AiSettingsDTO = {
      ...DEFAULT_AI_SETTINGS,
      enabled: settings.get("aiRelatedVersesEnabled") !== "false",
      apiKeyConfigured: !!decryptAiApiKey(encryptedApiKey),
      promptCommand: (settings.get("aiRelatedVersesPromptCommand") || DEFAULT_AI_PROMPT_COMMAND).trim() || DEFAULT_AI_PROMPT_COMMAND,
      cardCooldownSeconds: clampInteger(settings.get("aiRelatedVersesCardCooldownSeconds"), DEFAULT_AI_SETTINGS.cardCooldownSeconds, 0, 3600),
      userLimitPerMinute: clampInteger(settings.get("aiRelatedVersesUserLimitPerMinute"), DEFAULT_AI_SETTINGS.userLimitPerMinute, 1, 60),
      maxSuccessPerMessage: clampInteger(settings.get("aiRelatedVersesMaxSuccessPerMessage"), DEFAULT_AI_SETTINGS.maxSuccessPerMessage, 1, 20)
    };
    aiSettingsCache = { value, encryptedApiKey, loadedAt: Date.now() };
    return aiSettingsCache;
  }

  function resetAiSettingsCache() {
    aiSettingsCache = null;
  }

  return { loadAiSettings, resetAiSettingsCache, encryptAiApiKey, decryptAiApiKey };
}

export async function callDeepSeekBibleReferences(settings: AiSettingsDTO, apiKey: string, systemPrompt: string, contextText: string, limit: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${settings.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: contextText }
        ],
        thinking: { type: "disabled" },
        stream: false
      }),
      signal: controller.signal
    });
    const payload = (await response.json().catch(() => ({}))) as any;
    if (!response.ok) {
      const message = payload?.error?.message || payload?.message || `DeepSeek HTTP ${response.status}`;
      throw new Error(String(message));
    }
    const responseText = String(payload?.choices?.[0]?.message?.content || "").trim();
    if (!responseText) throw new Error("DeepSeek returned empty content");
    const references = parseAiVerseReferences(responseText, limit);
    if (!references.length) throw new Error("DeepSeek did not return verse references");
    return { responseText, references };
  } finally {
    clearTimeout(timeout);
  }
}

export function callDeepSeekRelatedVerses(settings: AiSettingsDTO, apiKey: string, contextText: string) {
  return callDeepSeekBibleReferences(settings, apiKey, settings.promptCommand, contextText, 3);
}
