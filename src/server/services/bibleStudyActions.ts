import type { Prisma, PrismaClient } from "@prisma/client";
import { bibleStudyBranchIds, type BibleStudyQuestion } from "../../shared/bibleStudy.js";
import { pendingAnswerSchema, pendingHelpSchema, pendingSkipSchema, studyCheckpointSchema, type StudyCheckpoint } from "./bibleStudyQuestions.js";

const escapeText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function numberedStudyQuestions(questions: BibleStudyQuestion[]) {
  const counts = new Map<number, number>();
  return [...questions].sort((a, b) => a.id - b.id).map((question, index) => {
    const parent = question.parentId ?? 0;
    const siblingNumber = question.siblingNumber ?? (counts.get(parent) ?? 0) + 1;
    counts.set(parent, Math.max(counts.get(parent) ?? 0, siblingNumber));
    return { ...question, number: question.number ?? index + 1, ...(question.parentId ? { siblingNumber } : {}) };
  });
}

export async function changeStudyQuestion(input: {
  prisma: PrismaClient; channelId: number; actorId: number; assistantId: number;
  checkpoint: { id: number; payload: unknown }; questions: BibleStudyQuestion[];
  questionId: number; action: "delete" | "skip"; expectedIds?: number[];
}): Promise<{ resume: boolean } | null> {
  const { prisma, channelId, actorId, assistantId, questionId, action } = input;
  const target = input.questions.find(question => question.id === questionId);
  if (!target) return null;
  const state = studyCheckpointSchema.parse(input.checkpoint.payload);
  const ordered = numberedStudyQuestions(input.questions);
  const currentId = state.currentQuestionId ?? ordered.at(-1)?.id;
  const ids = bibleStudyBranchIds(ordered, questionId);
  if (action === "delete" && JSON.stringify(ids) !== JSON.stringify([...new Set(input.expectedIds ?? [])].sort((a, b) => a - b))) return null;
  if (action === "skip" && target.skipped) return { resume: false };

  return prisma.$transaction(async tx => {
    const rows = await tx.message.findMany({
      where: { channelId, senderActorId: { in: [actorId, assistantId] }, id: { gte: state.sessionStartId } },
      orderBy: { id: "asc" }, select: { id: true, senderActorId: true, replyToId: true, content: true, payload: true }
    });
    const rowById = new Map(rows.map(row => [row.id, row]));
    if (action === "skip") {
      const row = rowById.get(questionId);
      if (!row) return null;
      const checkpoint = studyCheckpointSchema.parse(row.payload);
      await tx.message.update({ where: { id: row.id }, data: { payload: {
        ...checkpoint, question: { ...checkpoint.question, ...target, skipped: true }
      } } });
      if (currentId === questionId) await tx.message.createMany({ data: {
        channelId, senderActorId: actorId, content: "我选择跳过这个问题。",
        clientRequestId: `bible-study-skip:${questionId}`, payload: { kind: "bible_study_skip", questionId }
      }, skipDuplicates: true });
      return { resume: currentId === questionId };
    }

    const removed = new Set(ids);
    const relatedAnswers = new Set<number>();
    for (const row of rows) {
      if (row.senderActorId !== actorId || row.id === state.sessionStartId || !row.content) continue;
      const directed = pendingAnswerSchema.safeParse(row.payload);
      const help = pendingHelpSchema.safeParse(row.payload);
      const skip = pendingSkipSchema.safeParse(row.payload);
      const relatedId = directed.success ? directed.data.questionId : help.success ? help.data.questionId
        : skip.success ? skip.data.questionId : [...ordered].reverse().find(question => question.id < row.id)?.id;
      if (relatedId && removed.has(relatedId)) relatedAnswers.add(row.id);
    }
    const survivors = ordered.filter(question => !removed.has(question.id));
    const nextCurrent = currentId && !removed.has(currentId) ? currentId : survivors.at(-1)?.id;
    const sequence = Math.max(state.questionSequence ?? 0, ...ordered.map(question => question.number));
    const questionsById = new Map(ordered.map(question => [question.id, question]));
    for (const row of rows) {
      const decoded = studyCheckpointSchema.safeParse(row.payload);
      const question = questionsById.get(row.id);
      const erase = removed.has(row.id) || relatedAnswers.has(row.id) ||
        (row.senderActorId === assistantId && !!row.replyToId && relatedAnswers.has(row.replyToId) && !question);
      if (erase) {
        // Remove content and question text. Minimal checkpoints keep resume cursors
        // valid, so deletion cannot replay old answers or recreate removed branches.
        const payload: Prisma.InputJsonObject = decoded.success ? {
          kind: "bible_study_turn", stage: decoded.data.stage, reference: decoded.data.reference,
          sessionStartId: decoded.data.sessionStartId, questionSequence: sequence,
          responseOnly: true, deleted: true,
          ...(row.id === input.checkpoint.id ? {
            stage: nextCurrent ? survivors.find(question => question.id === nextCurrent)!.stage : "choose",
            reference: nextCurrent ? state.reference : null,
            ...(nextCurrent ? { currentQuestionId: nextCurrent } : {})
          } : {})
        } : { kind: "bible_study_removed", deleted: true };
        await tx.message.update({ where: { id: row.id }, data: { content: "", payload, ...(row.senderActorId === actorId ? { type: "system" } : {}) } });
      } else if (decoded.success && (question || row.id === input.checkpoint.id)) {
        const checkpoint: StudyCheckpoint = { ...decoded.data, questionSequence: sequence };
        if (question) checkpoint.question = question;
        if (row.id === input.checkpoint.id) {
          if (nextCurrent) checkpoint.currentQuestionId = nextCurrent;
          else { checkpoint.stage = "choose"; checkpoint.reference = null; delete checkpoint.question; }
        }
        const scrubResponse = !!row.replyToId && relatedAnswers.has(row.replyToId) && !!question;
        if (scrubResponse) { delete checkpoint.feedback; delete checkpoint.feedbackDetail; }
        await tx.message.update({ where: { id: row.id }, data: { payload: checkpoint,
          ...(scrubResponse ? { content: escapeText(question!.text) } : {})
        } });
      }
    }
    return { resume: false };
  });
}
