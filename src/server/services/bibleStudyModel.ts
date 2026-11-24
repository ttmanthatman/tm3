import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { QuestionAssistantChatMessage } from "./questionAssistantReply.js";
import type { BibleStudyFailure, BibleStudyStage } from "../../shared/bibleStudy.js";

export class BibleStudyModelError extends Error {
  constructor(readonly reason: BibleStudyFailure, readonly retryable = true) {
    super(reason);
  }
}

export function bibleStudyModelError(error: unknown) {
  if (error instanceof BibleStudyModelError) return error;
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") return new BibleStudyModelError("timeout");
    if (error instanceof TypeError) return new BibleStudyModelError("connection");
    const status = Number(/^AI HTTP (\d{3})$/.exec(error.message)?.[1]);
    if (status === 401 || status === 403 || status === 404 || status === 402) return new BibleStudyModelError("configuration", false);
    if (status) return new BibleStudyModelError("unavailable", status === 408 || status === 429 || status >= 500);
  }
  return new BibleStudyModelError("format");
}

const completionText = z.string().trim().min(2).max(1600);
const feedback = z.string().trim().max(80).optional().catch(undefined);
const navigation = {
  question: z.string().trim().min(2).max(400).optional().catch(undefined),
  purpose: z.string().trim().min(2).max(140).optional().catch(undefined),
  relation: z.enum(["deepen", "new_angle"]).optional().catch(undefined),
  evidence: z.array(z.string().trim().max(60)).max(6).optional().catch(undefined)
};
const turnSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ask"), text: completionText, feedback, ...navigation }),
  z.object({ action: z.literal("advance"), text: completionText, feedback, ...navigation }),
  z.object({
    action: z.literal("complete"), mainPoint: completionText, observations: completionText,
    gospel: completionText, response: completionText, takeaway: completionText
  })
]);
type StudyTurn = z.infer<typeof turnSchema>;
export type CompleteStudyMessages = (messages: QuestionAssistantChatMessage[], mode: "json" | "text") => Promise<string>;

const JSON_INSTRUCTIONS = '只返回 JSON 对象，不用代码块。继续本阶段用 {"action":"ask","text":"承接与一个问题","question":"单独列出本轮问题","purpose":"为什么在这里问","relation":"deepen","evidence":["经文出处"],"feedback":"还可以补充哪一点"}。达到本阶段目标才用 {"action":"advance","text":"承接与下一阶段的一个问题","question":"单独列出本轮问题","purpose":"如何用刚才的发现进入新阶段","evidence":["经文出处"],"feedback":"答复的具体长处"}。同阶段接着旧问题深挖用 deepen，观察同一段经文的另一个角度用 new_angle。evidence 只提供当前段落中与问题直接相关的一到两处经文。feedback 用不超过 30 字的具体反馈，只评当前答复的经文依据或具体程度，避免评价使用者个人。只有 response 阶段达到全部完成标准才用 {"action":"complete","mainPoint":"...","observations":"...","gospel":"...","response":"...","takeaway":"..."}。';
const TEXT_INSTRUCTIONS = "请直接用中文回复使用者。简短承接他刚才的答复，然后就当前阶段问一个具体问题，以问号结尾。停留在服务器给出的当前阶段，不进入下一阶段，不结束，也不生成小结。只发给使用者看的话。";

function structuredTurn(response: string, stage: BibleStudyStage, hint: boolean): StudyTurn {
  const turn = turnSchema.parse(JSON.parse(response.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")));
  if ((hint && turn.action !== "ask") || (turn.action === "complete" && stage !== "response")) throw new BibleStudyModelError("format");
  return turn;
}

function textFollowUp(response: string): StudyTurn | null {
  const parsed = completionText.safeParse(response);
  if (!parsed.success || /^[\s{[<`]/u.test(parsed.data) || !/[？?]$/u.test(parsed.data)) return null;
  return { action: "ask", text: parsed.data };
}

export async function completeBibleStudyTurn(
  complete: CompleteStudyMessages, messages: QuestionAssistantChatMessage[], stage: BibleStudyStage, hint = false
): Promise<StudyTurn> {
  function request(mode: "json" | "text") {
    const system = messages[0];
    return complete([
      { role: "system", content: `${system.content}\n\n${mode === "json" ? JSON_INSTRUCTIONS : TEXT_INSTRUCTIONS}` },
      ...messages.slice(1)
    ], mode);
  }

  let mode: "json" | "text" = "json";
  for (const attempt of [0, 1]) {
    try {
      const response = await request(mode);
      if (mode === "text") {
        const followUp = textFollowUp(response);
        if (followUp) return followUp;
        const turn = structuredTurn(response, stage, hint);
        if (turn.action === "ask") return turn;
        throw new BibleStudyModelError("format");
      }
      try {
        return structuredTurn(response, stage, hint);
      } catch (error) {
        const followUp = attempt === 1 ? textFollowUp(response) : null;
        if (followUp) return followUp;
        throw error;
      }
    } catch (error) {
      const failure = bibleStudyModelError(error);
      if (attempt === 1 || !failure.retryable) throw failure;
      if (failure.reason === "format") mode = "text";
      else await delay(600);
    }
  }
  throw new BibleStudyModelError("format");
}
