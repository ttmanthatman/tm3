import type { AiClient } from "./ai.js";
import type { UrgeResult, SnapshotMessage, CharacterConfig } from "./types.js";

export function createUrgeEvaluator(ai: AiClient) {

  function buildBioSummary(config: CharacterConfig): string {
    const bio = config.bio;
    if (!bio) return config.emotionBaseline || "一个普通人";
    const parts: string[] = [];
    if (bio.basics?.identity) parts.push(`身份: ${bio.basics.identity}`);
    if (bio.values?.coreBeliefs?.length) parts.push(`信念: ${bio.values.coreBeliefs.join("; ")}`);
    if (bio.personality?.thinkingStyle) parts.push(`思维: ${bio.personality.thinkingStyle}`);
    if (bio.personality?.emotionalPattern) parts.push(`情绪: ${bio.personality.emotionalPattern}`);
    if (bio.expertise?.strengths?.length) parts.push(`擅长: ${bio.expertise.strengths.join(", ")}`);
    return parts.join(" | ") || config.emotionBaseline || "一个普通人";
  }

  async function evaluate(input: {
    characterName: string;
    config: CharacterConfig;
    recentMessages: SnapshotMessage[];
    emotion: string | null;
    turnsSinceLastSpeak: number;
    silenceSeconds: number;
    myActorId: number;
    model?: string;
  }): Promise<UrgeResult> {
    const bioSummary = buildBioSummary(input.config);

    const recentText = input.recentMessages.length > 0
      ? input.recentMessages.map((m) => `[第${m.turnIndex}轮 ${m.wallClock.toISOString().slice(11, 16)}] ${m.speakerName}: ${m.content}`).join("\n")
      : "（还没有人说话）";

    const systemPrompt = `你是 ${input.characterName}。下面是最近几轮对话和你的状态。
判断你现在是否想发言。想发言的场景：
- 有人直接回应你的观点
- 话题撞到你的擅长领域
- 你想反驳某人
- 你的情绪被激起来了
- 全场沉默太久你想打破
- 你很久没说话了有话憋着
不想发言也正常。输出 JSON：{"wantToSpeak": true/false, "reason": "一句话", "urgency": "low/mid/high"}`;

    const userPrompt = `你的身份与性格：${bioSummary}
你当前的情绪：${input.emotion || input.config.emotionBaseline}

最近对话：
${recentText}

时间信息：
- 你距离上次发言已过了 ${input.turnsSinceLastSpeak} 轮
- 全场最近一次发言在 ${input.silenceSeconds} 秒前

输出 JSON：`;

    try {
      const result = await ai.callUrgeModel(systemPrompt, userPrompt, input.model);
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { wantToSpeak: false, reason: "评估无输出", urgency: "low" };
      }
      const parsed = JSON.parse(jsonMatch[0]) as Partial<UrgeResult>;
      return {
        wantToSpeak: !!parsed.wantToSpeak,
        reason: String(parsed.reason || ""),
        urgency: parsed.urgency === "high" ? "high" : parsed.urgency === "mid" ? "mid" : "low",
      };
    } catch {
      return { wantToSpeak: false, reason: "评估异常", urgency: "low" };
    }
  }

  return { evaluate };
}

export type UrgeEvaluator = ReturnType<typeof createUrgeEvaluator>;
