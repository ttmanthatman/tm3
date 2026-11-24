import { type Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { BIBLE_STUDY_ASSISTANT, BIBLE_STUDY_ROOM, BIBLE_STUDY_RETRY_PREFIX, BIBLE_STUDY_RESUME_COMMANDS, BIBLE_STUDY_STAGES, bibleStudyRoomKey, type BibleStudyFailure, type BibleStudyWorkspaceState, type BibleStudyQuestion, type BibleStudyAnswerRequest } from "../../shared/bibleStudy.js";
import { lookupBibleReference } from "../bible/lookup.js";
import { changeStudyQuestion, numberedStudyQuestions } from "./bibleStudyActions.js";
import { BIBLE_STUDY_PROMPT } from "./bibleStudyPrompt.js";
import { BIBLE_STUDY_FIRST_QUESTION, bibleStudyReading } from "./bibleStudyReading.js";
import { BibleStudyModelError, completeBibleStudyTurn, type CompleteStudyMessages } from "./bibleStudyModel.js";
import type { QuestionAssistantChatMessage } from "./questionAssistantReply.js";
import { BIBLE_STUDY_LOCKED_NOTE, pendingHelpSchema, pendingAnswerSchema, pendingSkipSchema, studyCheckpointSchema as checkpointSchema, type StudyCheckpoint as Checkpoint, plainStudyText as plain, passageEvidence,
  questionPurpose, questionText, studyQuestions, studyQuestionFromMessage } from "./bibleStudyQuestions.js";

const stages = {
  observe: "引导指出段落的关键细节和必要的上下文。用户已能说出带经文依据的观察时，进入原意，问一个解释问题。",
  interpret: "帮助用日常语言说出段落主旨，并用一两节经文支持。达到后，问从这段经文怎样看见神、怎样联系基督的救恩。",
  gospel: "厘清神怎样显明自己，以及基督做成的事如何回应本段的需要。达到后，请用户举一个触及自己的实际或假设情境。",
  situation: "找到具体处境和原来如何理解或回应。达到后，问在这个处境中基督的恩典如何回应原先的信念或倚靠。",
  grace: "说清一项基督已做成的事怎样改变那个看法和反应。达到后，问下一次在相同情境里可以作出什么具体选择。",
  response: "核对使用者已有经文依据、福音依据和一项出于恩典的具体选择。这些都出现在本轮对话才可以提交小结，否则再问一个具体问题。"
} as const;

const stageSchema = z.enum(BIBLE_STUDY_STAGES);
const welcome = "欢迎来到问答式查经。这里的查经答复会保存，站点管理员可以在后台查看。当前查经对话由站点配置的 AI 服务处理。你可以用匿名或假设的处境来讨论。\n\n你想查哪段经文？可以直接发经文范围，例如「马可福音 4:35-41」，也可以在范围后另起一行贴出想用的译文。";
const substantiveAnswer = { content: { notIn: ["", ...BIBLE_STUDY_RESUME_COMMANDS] } } satisfies Prisma.MessageWhereInput;

const retryNote = "这一轮暂时没有生成回应，你的答复已经保存。";
const failureSchema = z.enum(["configuration", "connection", "timeout", "unavailable", "format"]);
function passageFrom(text: string) {
  const firstLine = text.split("\n", 1)[0].trim().replace(/^(?:我想|今天)?\s*(?:查经|查考|查|读)\s*[：:]?\s*/u, "");
  if (!firstLine || firstLine.length > 100) return null;
  try {
    const passage = lookupBibleReference(firstLine);
    return passage.verses.length > 0 && passage.verses.length <= 30 ? passage : null;
  } catch (error) {
    if (error instanceof Error && /^(?:empty reference|unrecognized reference|unknown book|invalid range|verse not found|chapter not found)$/.test(error.message)) return null;
    throw error;
  }
}

function asksToStopOrSwitch(text: string) {
  return /^(?:(?:我想|我们|请|能不能|可以|先)\s*)*(?:\/(?:结束|停止|换题|重开|新话题)|(?:换|改)(?:一(?:段|处|个)|经文|话题|题目|到|查|成)|(?:重新|重开)(?:开始|查经)?|(?:结束|停止|退出)(?:本次|这次)?(?:查经|对话)?[吧了。！!\s]*$|(?:总结|小结)[吧了。！!\s]*$|(?:直接|只要|提前|现在就)(?:做|给我|生成)?(?:总结|小结|结束))/u.test(text);
}

export function createBibleStudy(deps: {
  prisma: PrismaClient;
  complete: CompleteStudyMessages;
  emit: (id: number) => Promise<unknown>;
  notifyProgress: (channelId: number) => void;
  onError: (channelId: number, reason: BibleStudyFailure | "internal") => void;
}) {
  const { prisma } = deps;
  const queues = new Map<number, Promise<void>>();
  const submitting = new Set<number>();
  const isResume = (text: string | null) => BIBLE_STUDY_RESUME_COMMANDS.some(command => command === text);

  async function assistantId() {
    await prisma.actor.createMany({ data: { ...BIBLE_STUDY_ASSISTANT, kind: "virtual" }, skipDuplicates: true });
    const actor = await prisma.actor.findUniqueOrThrow({ where: { username: BIBLE_STUDY_ASSISTANT.username }, select: { id: true, kind: true } });
    if (actor.kind !== "virtual") throw new Error("查经助手账号不可用");
    return actor.id;
  }

  async function enter(accountId: number) {
    const directKey = bibleStudyRoomKey(accountId);
    const senderActorId = await assistantId();
    const channelId = await prisma.$transaction(async (tx) => {
      await tx.channel.createMany({
        data: { kind: "direct", name: BIBLE_STUDY_ROOM, isPrivate: true, directKey, icon: "", description: "个人查经与小结" }, skipDuplicates: true
      });
      const room = await tx.channel.findUniqueOrThrow({ where: { directKey }, select: { id: true } });
      await tx.channelMember.createMany({ data: { channelId: room.id, accountId }, skipDuplicates: true });
      await tx.message.createMany({
        data: { channelId: room.id, senderActorId, clientRequestId: `bible-study-welcome:${room.id}`, content: welcome }, skipDuplicates: true
      });
      await tx.channel.update({ where: { id: room.id }, data: { name: BIBLE_STUDY_ROOM } });
      return room.id;
    });
    return channelId;
  }

  function latestCheckpoint(channelId: number, senderActorId: number) {
    return prisma.message.findFirst({
      where: { channelId, senderActorId, payload: { path: "$.kind", equals: "bible_study_turn" } },
      orderBy: { id: "desc" }, select: { id: true, replyToId: true, payload: true, content: true }
    });
  }

  async function progress(channelId: number, actorId: number): Promise<BibleStudyWorkspaceState> {
    const sender = await prisma.actor.findUnique({ where: { username: BIBLE_STUDY_ASSISTANT.username }, select: { id: true } });
    const last = sender && await latestCheckpoint(channelId, sender.id);
    if (!sender || !last) return { progress: null, latest: null };
    const state = checkpointSchema.parse(last.payload);
    if (state.stage === "choose" || state.stage === "complete" || !state.reference) {
      return { progress: null, latest: state.stage === "complete" ? "complete" : null };
    }
    const [pending, recent, first] = await Promise.all([
      prisma.message.findFirst({
        where: { channelId, senderActorId: actorId, type: "text", ...substantiveAnswer, id: { gt: last.replyToId ?? 0 } },
        orderBy: { id: "asc" }, select: { id: true }
      }),
      studyQuestions(prisma, channelId, sender.id, state.sessionStartId),
      prisma.message.findFirst({
        where: { channelId, senderActorId: sender.id, replyToId: state.sessionStartId },
        orderBy: { id: "asc" }, select: { payload: true, content: true }
      })
    ]);
    const failureRow = pending && await prisma.message.findUnique({
      where: { senderActorId_clientRequestId: { senderActorId: sender.id, clientRequestId: BIBLE_STUDY_RETRY_PREFIX + pending.id } },
      select: { payload: true, channelId: true }
    });
    const failure = failureRow && failureRow.channelId === channelId
      ? z.object({ reason: failureSchema }).safeParse(failureRow.payload)
      : null;
    const answerRows = await prisma.message.findMany({
      where: { channelId, senderActorId: actorId, id: { gt: state.sessionStartId }, type: "text" },
      orderBy: { id: "asc" }, select: { id: true, content: true, payload: true,
        replies: { where: { content: { not: "" }, senderActorId: sender.id, payload: { path: "$.kind", equals: "bible_study_turn" } }, select: { content: true }, orderBy: { id: "asc" }, take: 1 }
      }
    });
    const ordered = numberedStudyQuestions(recent);
    const answers = answerRows.flatMap(row => {
      const metadata = pendingAnswerSchema.safeParse(row.payload);
      const help = pendingHelpSchema.safeParse(row.payload);
      if (help.success || pendingSkipSchema.safeParse(row.payload).success || isResume(row.content)) return [];
      const questionId = metadata.success ? metadata.data.questionId : [...ordered].reverse().find(q => q.id < row.id)?.id;
      if (!questionId || (metadata.success && metadata.data.mode !== "answer")) return [];
      return [{ id: row.id, questionId, text: plain(row.content), response: plain(row.replies[0]?.content) || undefined }];
    });
    return {
      latest: last.content?.startsWith(BIBLE_STUDY_LOCKED_NOTE) ? "locked" : null,
      progress: {
        stage: state.stage, reference: state.reference, questions: ordered.length, feedback: state.feedback ?? null, feedbackDetail: state.feedbackDetail,
        working: !!pending && queues.has(channelId),
        failure: failure ? failure.success ? failure.data.reason : "unavailable" : null,
        reading: first ? bibleStudyReading({ ...first, sender: BIBLE_STUDY_ASSISTANT }) : undefined,
        questionPath: ordered, answers
      }
    };
  }

  async function findQuestion(channelId: number, senderActorId: number, startId: number, id: number) {
    const row = await prisma.message.findFirst({
      where: { channelId, senderActorId, id, replyToId: { gte: startId } },
      select: { id: true, content: true, payload: true }
    });
    return row ? studyQuestionFromMessage(row) : undefined;
  }

  async function requestHelp(channelId: number, actorId: number, questionId: number) {
    const { progress: current } = await progress(channelId, actorId);
    if (!current || current.questionPath.at(-1)?.id !== questionId) return false;
    const clientRequestId = `bible-study-help:${questionId}`;
    const existing = await prisma.message.findUnique({
      where: { senderActorId_clientRequestId: { senderActorId: actorId, clientRequestId } },
      select: { channelId: true }
    });
    if (existing?.channelId === channelId) { retry(channelId, actorId); return true; }
    if (current.working || current.failure) return false;
    await prisma.message.createMany({
      data: {
        channelId, senderActorId: actorId, clientRequestId, content: "答不上来",
        payload: { kind: "bible_study_help", questionId }
      },
      skipDuplicates: true
    });
    resume(channelId, actorId);
    return true;
  }

  async function submitAnswer(channelId: number, actorId: number, input: BibleStudyAnswerRequest) {
    if (submitting.has(channelId)) return false;
    submitting.add(channelId);
    try {
      const clientRequestId = `bible-study-answer:${input.clientRequestId}`;
      const saved = await prisma.message.findUnique({
        where: { senderActorId_clientRequestId: { senderActorId: actorId, clientRequestId } },
        select: { channelId: true, content: true, payload: true }
      });
      if (saved) {
        const metadata = pendingAnswerSchema.safeParse(saved.payload);
        const matches = saved.channelId === channelId && plain(saved.content) === input.content && metadata.success &&
          metadata.data.questionId === input.questionId && metadata.data.mode === input.mode && metadata.data.evidence === input.evidence;
        if (matches) retry(channelId, actorId);
        return matches;
      }
      const { progress: current } = await progress(channelId, actorId);
      if (!current || current.working || current.failure) return false;
      const target = current.questionPath.find(question => question.id === input.questionId);
      if (!target) return false;
      if (input.evidence && !passageEvidence(current.reference, [input.evidence]).length) return false;
      await prisma.message.create({ data: {
        channelId, senderActorId: actorId, clientRequestId,
        content: input.content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
        payload: { kind: "bible_study_answer", questionId: target.id, mode: input.mode, ...(input.evidence ? { evidence: input.evidence } : {}) }
      } });
      resume(channelId, actorId);
      return true;
    } finally { submitting.delete(channelId); }
  }

  async function manageQuestion(channelId: number, actorId: number, questionId: number, action: "delete" | "skip", expectedIds?: number[]) {
    if (submitting.has(channelId) || queues.has(channelId)) return false;
    submitting.add(channelId);
    try {
      const { progress: current } = await progress(channelId, actorId);
      if (!current || current.working || current.failure) return false;
      const senderActorId = await assistantId();
      const checkpoint = await latestCheckpoint(channelId, senderActorId);
      if (!checkpoint) return false;
      const result = await changeStudyQuestion({ prisma, channelId, actorId, assistantId: senderActorId,
        checkpoint, questions: current.questionPath, questionId, action, expectedIds });
      if (!result) return false;
      if (result.resume) resume(channelId, actorId); else deps.notifyProgress(channelId);
      return true;
    } finally { submitting.delete(channelId); }
  }

  async function processNext(channelId: number, actorId: number, senderActorId: number) {
    const last = await latestCheckpoint(channelId, senderActorId);
    const previous = last ? checkpointSchema.parse(last.payload) : null;
    const answer = await prisma.message.findFirst({
      where: { channelId, senderActorId: actorId, type: "text", ...substantiveAnswer, id: { gt: last?.replyToId ?? 0 } },
      orderBy: { id: "asc" }, select: { id: true, content: true, payload: true }
    });
    if (!answer) return false;
    const { id: answerId } = answer;
    const text = plain(answer.content);
    const newSession = !previous || previous.stage === "complete";
    const next: Checkpoint = newSession
      ? { kind: "bible_study_turn", stage: "choose", reference: null, sessionStartId: answer.id }
      : { ...previous };
    let previousQuestion = newSession ? undefined : next.currentQuestionId
      ? await findQuestion(channelId, senderActorId, next.sessionStartId, next.currentQuestionId)
      : (await studyQuestions(prisma, channelId, senderActorId, next.sessionStartId))[0];
    const skipping = pendingSkipSchema.safeParse(answer.payload);
    const directed = pendingAnswerSchema.safeParse(answer.payload);
    if (directed.success && !newSession) {
      const target = await findQuestion(channelId, senderActorId, next.sessionStartId, directed.data.questionId);
      if (!target) throw new Error("Study question target missing");
      previousQuestion = target;
      next.stage = target.stage;
    }
    if (skipping.success && !newSession) {
      previousQuestion = await findQuestion(channelId, senderActorId, next.sessionStartId, skipping.data.questionId);
      if (!previousQuestion) throw new Error("Study skip target missing");
      next.stage = previousQuestion.stage;
    }
    const branching = directed.success && directed.data.mode === "followup";
    const helpRequest = pendingHelpSchema.safeParse(answer.payload);
    if (helpRequest.success && previousQuestion?.id !== helpRequest.data.questionId) {
      // The user answered in another tab before the hint was processed. Keep the
      // help event in the transcript without making it an answer to the new question.
      await prisma.message.updateMany({ where: { channelId, senderActorId: actorId, id: answerId }, data: { type: "system" } });
      return true;
    }
    const wantsHint = !!previousQuestion && (helpRequest.success || /^(?:我)?(?:不知道|答不上来|没看出来|想不到)[。！!]*$/u.test(text));
    delete next.question;
    delete next.responseOnly;
    delete next.deleted;
    delete next.currentQuestionId;
    const candidate = passageFrom(text);
    let content: string;
    let markdown = false;
    if (next.stage === "choose") {
      if (!candidate) {
        content = "你想查哪段经文？请发一段经文的范围（最多 30 节），例如「马可福音 4:35-41」。";
      } else {
        next.reference = candidate.normalizedReference;
        next.sessionStartId = answer.id;
        next.questionSequence = 0;
        next.stage = "observe";
        next.question = { relation: "opening", text: BIBLE_STUDY_FIRST_QUESTION, purpose: questionPurpose("observe", "opening"), evidence: [] };
        const suppliedText = text.slice(text.indexOf("\n") + 1).trim();
        const passageText = text.includes("\n") && suppliedText
          ? suppliedText
          : candidate.verses.map(verse => `${verse.reference} ${verse.text}`).join("\n");
        const source = text.includes("\n") && suppliedText ? "你提供的经文" : candidate.translation;
        content = `${candidate.normalizedReference}（${source}）\n${passageText}\n\n${BIBLE_STUDY_FIRST_QUESTION}`;
      }
    } else if (asksToStopOrSwitch(text) || (candidate && candidate.normalizedReference !== next.reference && !text.includes("\n"))) {
      content = `${BIBLE_STUDY_LOCKED_NOTE}\n\n我们继续看 ${next.reference}。请接着回答上一个查经问题。`;
    } else if (!wantsHint && !branching && !skipping.success && !directed.success && previousQuestion?.relation === "hint" && previousQuestion.returnToId) {
      const original = await findQuestion(channelId, senderActorId, next.sessionStartId, previousQuestion.returnToId);
      if (!original) throw new Error("Study hint target missing");
      next.question = {
        relation: "return", text: original.text, purpose: questionPurpose(original.stage, "return"),
        parentId: previousQuestion.id, returnToId: original.id, evidence: original.evidence
      };
      delete next.feedback;
      delete next.feedbackDetail;
      content = `${next.question.purpose}

${original.text}`;
    } else {
      const stage = stageSchema.parse(next.stage);
      try {
        const passage = lookupBibleReference(next.reference!);
        // The opening turn and the latest exchanges belong to this session. Older summaries are never sent.
        const [answers, questions] = await Promise.all([
          prisma.message.findMany({
            where: { channelId, type: "text", senderActorId: actorId, ...substantiveAnswer, id: { gte: next.sessionStartId, lt: answerId } },
            orderBy: { id: "desc" }, take: 16, select: { id: true, content: true }
          }),
          prisma.message.findMany({
            where: {
              channelId, senderActorId, content: { not: "" }, replyToId: { gte: next.sessionStartId, lt: answerId },
              payload: { path: "$.kind", equals: "bible_study_turn" }
            },
            orderBy: { id: "desc" }, take: 16, select: { replyToId: true, content: true }
          })
        ]);
        const promptsByAnswer = new Map(questions.map(row => [row.replyToId, row.content]));
        const history: QuestionAssistantChatMessage[] = answers.reverse().flatMap(row => [
          { role: "user", content: plain(row.content) },
          { role: "assistant", content: plain(promptsByAnswer.get(row.id)) }
        ]);
        const opening = answers.some(row => row.id === next.sessionStartId)
          ? null
          : await prisma.message.findUnique({ where: { id: next.sessionStartId }, select: { content: true } });
        const turn = await completeBibleStudyTurn(deps.complete, [
          { role: "system", content: [
            BIBLE_STUDY_PROMPT,
            `本次锁定：${next.reference}（${passage.translation}）。\n${passage.verses.map(verse => `${verse.reference} ${verse.text}`).join("\n")}`,
            `当前阶段：${stage}。目标：${stages[stage]}`,
            ...(directed.success ? [`当前答复明确关联问题：${previousQuestion?.text}。只承接这道题，不承接最近另一分支的问题。${branching ? "用户要在这道题下另开追问分支，只返回 ask 并保持当前阶段。" : ""}${directed.data.evidence ? `只围绕用户选定经文 ${directed.data.evidence} 提问，evidence 必须包含此范围。` : ""}`] : []),
            ...(skipping.success ? [`用户不想回答「${previousQuestion?.text}」。只跳过这道题，保留记录和已有子问题；不要再次要求回答或把它拆小，不把跳过当作已达标。保持阶段，只返回 ask，从另一个角度提出一个新问题。`] : []),
            ...(wantsHint ? [`用户暂时答不上来。现在只做当前问题的提示。把「${previousQuestion?.text}」拆成一个更容易、可直接从经文找答案的小问题，指定一小处相关经文；只返回 ask，留在当前阶段，避免直接替用户回答原题。`] : [])
          ].join("\n\n") },
          ...(opening ? [{ role: "user" as const, content: plain(opening.content) }] : []),
          ...history,
          { role: "user", content: text }
        ], stage, wantsHint || branching || skipping.success);
        if (turn.action === "complete") {
          next.stage = "complete";
          content = [
            `**今日带走 · ${next.reference}**`, `**经文与主旨**\n${turn.mainPoint}`, `**今天看见**\n${turn.observations}`,
            `**福音怎样触及我**\n${turn.gospel}`, `**我的具体回应**\n${turn.response}`, `**一句带走的话**\n${turn.takeaway}`,
            "这次查经已完成。小结已归档。想开始下一次查经时，直接发新的经文范围。"
          ].join("\n\n");
          markdown = true;
        } else if (turn.action === "respond") {
          next.responseOnly = true;
          if (previousQuestion) next.currentQuestionId = previousQuestion.id;
          delete next.feedback; delete next.feedbackDetail;
          content = turn.text;
        } else {
          const advanced = turn.action === "advance" && stage !== "response";
          next.feedback = advanced ? "ready" : "needs_detail";
          if (turn.feedback) next.feedbackDetail = turn.feedback;
          else delete next.feedbackDetail;
          const nextStage = advanced ? BIBLE_STUDY_STAGES[BIBLE_STUDY_STAGES.indexOf(stage) + 1] : stage;
          next.stage = nextStage;
          const relation: BibleStudyQuestion["relation"] = wantsHint ? "hint" : skipping.success ? "new_angle" : advanced ? "advance" : turn.relation ?? "deepen";
          next.question = {
            relation, text: turn.question ?? questionText(turn.text),
            purpose: turn.purpose || questionPurpose(nextStage, relation),
            ...(!advanced && previousQuestion ? { parentId: relation === "new_angle" && !branching ? previousQuestion.parentId : previousQuestion.id } : {}),
            ...(wantsHint && previousQuestion ? { returnToId: previousQuestion.returnToId ?? previousQuestion.id } : {}),
            evidence: passageEvidence(next.reference!, directed.success && directed.data.evidence ? [directed.data.evidence] : turn.evidence)
          };
          if (wantsHint || skipping.success) { delete next.feedback; delete next.feedbackDetail; }
          content = turn.text;
        }
      } catch (error) {
        if (!(error instanceof BibleStudyModelError)) throw error;
        deps.onError(channelId, error.reason);
        const clientRequestId = BIBLE_STUDY_RETRY_PREFIX + answerId;
        const payload = { kind: "bible_study_retry", reason: error.reason };
        await publish(clientRequestId, retryNote, payload);
        await prisma.message.updateMany({ where: { channelId, senderActorId, clientRequestId }, data: { content: retryNote, payload } });
        return false;
      }
    }

    if (next.question) {
      const existing = numberedStudyQuestions(await studyQuestions(prisma, channelId, senderActorId, next.sessionStartId));
      next.questionSequence = Math.max(next.questionSequence ?? 0, ...existing.map(question => question.number), 0) + 1;
      next.question.number = next.questionSequence;
      if (next.question.parentId) next.question.siblingNumber = Math.max(0, ...existing.filter(question => question.parentId === next.question?.parentId).map(question => question.siblingNumber ?? 0)) + 1;
    }
    await publish(`bible-study-turn:${answerId}`, content, { ...next, ...(markdown ? { contentFormat: "markdown" } : {}) });
    return true;

    async function publish(clientRequestId: string, content: string, payload: Prisma.InputJsonObject) {
      const written = await prisma.message.createMany({
        data: {
          channelId, senderActorId, clientRequestId, content: content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"), replyToId: answerId,
          payload
        }, skipDuplicates: true
      });
      if (!written.count) return;
      const row = await prisma.message.findUniqueOrThrow({ where: { senderActorId_clientRequestId: { senderActorId, clientRequestId } }, select: { id: true } });
      await deps.emit(row.id);
    }
  }

  function resume(channelId: number, actorId: number) {
    const pending = queues.get(channelId);
    const work = (pending ?? Promise.resolve()).then(async () => {
      const senderActorId = await assistantId();
      while (await processNext(channelId, actorId, senderActorId)) {
        // Drain saved answers in send order, including answers left pending after a restart.
      }
    }).catch(() => deps.onError(channelId, "internal"));
    queues.set(channelId, work);
    if (!pending) deps.notifyProgress(channelId);
    void work.then(() => {
      if (queues.get(channelId) !== work) return;
      queues.delete(channelId);
      deps.notifyProgress(channelId);
    });
  }

  function retry(channelId: number, actorId: number) {
    if (!queues.has(channelId)) resume(channelId, actorId);
  }

  return { enter, progress, resume, retry, requestHelp, submitAnswer, manageQuestion };
}
