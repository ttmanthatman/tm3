import { BIBLE_STUDY_ASSISTANT, type BibleStudyReading } from "../../shared/bibleStudy.js";
import { bibleStudyParagraphs } from "../bible/lookup.js";

export const BIBLE_STUDY_FIRST_QUESTION = "先慢慢读一遍。哪一句话或哪一个细节最先引起你的注意？";

export function bibleStudyReading(message: {
  sender: { username: string };
  content: string | null;
  payload: unknown;
}): BibleStudyReading | undefined {
  if (message.sender.username !== BIBLE_STUDY_ASSISTANT.username || !message.content || !message.payload ||
      typeof message.payload !== "object" || Array.isArray(message.payload)) return;
  const { kind, reference, stage } = message.payload as Record<string, unknown>;
  if (kind !== "bible_study_turn" || stage !== "observe" || typeof reference !== "string") return;
  const tail = `\n\n${BIBLE_STUDY_FIRST_QUESTION}`;
  if (!message.content.startsWith(`${reference}（`) || !message.content.endsWith(tail)) return;
  const firstBreak = message.content.indexOf("\n");
  if (firstBreak < 0) return;
  const decode = (text: string) => text.replace(/&(?:amp|lt|gt);/g, token =>
    ({ "&amp;": "&", "&lt;": "<", "&gt;": ">" })[token] ?? token);
  const title = decode(message.content.slice(0, firstBreak));
  const body = decode(message.content.slice(firstBreak + 1, -tail.length));
  const paragraphs = title.endsWith("（你提供的经文）")
    ? body.split(/\n\s*\n/u).map(text => [{ text: text.replaceAll("\n", "") }])
    : bibleStudyParagraphs(reference);
  return paragraphs.length ? { title, paragraphs, question: BIBLE_STUDY_FIRST_QUESTION } : undefined;
}
