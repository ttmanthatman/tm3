import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { BIBLE_STUDY_RELATIONS, BIBLE_STUDY_STAGE_DETAILS, BIBLE_STUDY_STAGES, type BibleStudyQuestion, type BibleStudyStage } from "../../shared/bibleStudy.js";
import { lookupBibleReference } from "../bible/lookup.js";
import { plainTextFromHtml } from "../textUtils.js";
import { BIBLE_STUDY_FIRST_QUESTION } from "./bibleStudyReading.js";

export const BIBLE_STUDY_LOCKED_NOTE = "这次查经需要完成后才可以换题。如果现在需要休息，下次回来可以接着查。";

export function plainStudyText(text: string | null | undefined, maxLength = 10_000) {
  return plainTextFromHtml(text, maxLength).replace(/&(?:amp|lt|gt|quot|apos|#39|nbsp);/g, entity =>
    ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'", "&nbsp;": " " })[entity] ?? entity);
}

export const studyAnswerSchema = z.object({
  questionId: z.number().int().positive(),
  content: z.string().trim().min(1).max(10_000),
  mode: z.enum(["answer", "followup"]),
  clientRequestId: z.string().uuid(),
  evidence: z.string().max(100).optional()
}).strict();
export const pendingAnswerSchema = studyAnswerSchema.omit({ content: true, clientRequestId: true })
  .extend({ kind: z.literal("bible_study_answer") });

export const pendingHelpSchema = z.object({ kind: z.literal("bible_study_help"), questionId: z.number().int().positive() });
export const studyQuestionSchema = z.object({
  text: z.string().min(1).max(1600),
  purpose: z.string().max(160),
  relation: z.enum(BIBLE_STUDY_RELATIONS),
  parentId: z.number().int().positive().optional(),
  returnToId: z.number().int().positive().optional(),
  evidence: z.array(z.string().max(100)).max(6)
});

const turnMetadata = z.object({ kind: z.literal("bible_study_turn"), stage: z.enum(BIBLE_STUDY_STAGES), question: studyQuestionSchema.optional() });

export function questionText(value: string) {
  const sentences = value.trim().match(/[^。！？?!\r\n]+[？?]/gu);
  return sentences?.at(-1)?.trim() || value.trim();
}

export function studyQuestionFromMessage(row: { id: number; content: string | null; payload: unknown }): BibleStudyQuestion | undefined {
  const parsed = turnMetadata.safeParse(row.payload);
  if (!parsed.success || !row.content || row.content.startsWith(BIBLE_STUDY_LOCKED_NOTE)) return;
  const { stage, question } = parsed.data;
  if (question) return { id: row.id, stage, ...question };
  const opening = row.content.endsWith(BIBLE_STUDY_FIRST_QUESTION);
  return {
    id: row.id, stage,
    text: opening ? BIBLE_STUDY_FIRST_QUESTION : questionText(plainStudyText(row.content)),
    purpose: BIBLE_STUDY_STAGE_DETAILS[stage].goal,
    relation: opening ? "opening" : "earlier", evidence: []
  };
}

export async function studyQuestions(prisma: PrismaClient, channelId: number, senderActorId: number, sessionStartId: number, take?: number) {
  const rows = await prisma.message.findMany({
    where: {
      channelId, senderActorId, replyToId: { gte: sessionStartId },
      payload: { path: "$.kind", equals: "bible_study_turn" },
      NOT: { content: { startsWith: BIBLE_STUDY_LOCKED_NOTE } }
    },
    orderBy: { id: "desc" }, ...(take ? { take } : {}), select: { id: true, content: true, payload: true }
  });
  return rows.flatMap(row => {
    const question = studyQuestionFromMessage(row);
    return question ? [question] : [];
  });
}

export function passageEvidence(reference: string, evidence: string[] = []) {
  if (!evidence.length) return [];
  const eligible = new Set(lookupBibleReference(reference).verses.map(verse => verse.reference));
  return [...new Set(evidence.flatMap(input => {
    if (!input) return [];
    try {
      const passage = lookupBibleReference(input);
      return passage.verses.length && passage.verses.every(verse => eligible.has(verse.reference)) ? [passage.normalizedReference] : [];
    } catch (error) {
      if (error instanceof Error && /^(?:empty reference|unrecognized reference|unknown book|invalid range|verse not found|chapter not found)$/.test(error.message)) return [];
      throw error;
    }
  }))].slice(0, 3);
}

export function questionPurpose(stage: BibleStudyStage, relation: BibleStudyQuestion["relation"]) {
  if (relation === "hint") return "先找一个具体的经文细节，答完再回到原题。";
  if (relation === "return") return "用刚才找到的细节，再回到原来的问题。";
  return BIBLE_STUDY_STAGE_DETAILS[stage].goal;
}
