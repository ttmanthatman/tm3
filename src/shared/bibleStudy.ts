export const BIBLE_STUDY_ASSISTANT = { username: "system:bible-study", displayName: "查经助手" } as const;
export const BIBLE_STUDY_ROOM = "问答式查经";
export const BIBLE_STUDY_ROOM_KEY_PREFIX = "virtual:bible-study:";

export function bibleStudyRoomKey(accountId: number) {
  return BIBLE_STUDY_ROOM_KEY_PREFIX + accountId;
}

export function isBibleStudyRoom(directKey?: string | null) {
  return !!directKey?.startsWith(BIBLE_STUDY_ROOM_KEY_PREFIX);
}

export function bibleStudyMention(text: string) {
  const mention = /(^|[\s，。！？、,.!?:;；：「（(])@查经助手(?=$|[\s，。！？、,.!?:;；：」）)])/u;
  if (!mention.test(text)) return null;
  return text.replace(mention, "$1").trim().replace(/^[，。！？、,.!?:;；：]+\s*/u, "");
}

export interface BibleStudyRecord {
  id: number;
  content: string;
  sender: string;
  createdAt: string;
  summary: boolean;
  question?: BibleStudyQuestion;
}

export interface BibleStudyRecordPage {
  records: BibleStudyRecord[];
  nextBefore: number | null;
}

export const BIBLE_STUDY_STAGES = ["observe", "interpret", "gospel", "situation", "grace", "response"] as const;
export type BibleStudyStage = typeof BIBLE_STUDY_STAGES[number];
export type BibleStudyFeedback = "ready" | "needs_detail";
export type BibleStudyFailure = "configuration" | "connection" | "timeout" | "unavailable" | "format";
export interface BibleStudyProgress {
  stage: BibleStudyStage;
  reference: string;
  questions: number;
  feedback: BibleStudyFeedback | null;
  feedbackDetail?: string;
  working: boolean;
  failure: BibleStudyFailure | null;
  reading?: BibleStudyReading;
  questionPath: BibleStudyQuestion[];
  answers?: BibleStudyAnswer[];
}

export interface BibleStudyWorkspaceState {
  progress: BibleStudyProgress | null;
  latest: "locked" | "complete" | null;
}

export interface BibleStudyReading {
  title: string;
  paragraphs: Array<Array<{ text: string; number?: string }>>;
  question: string;
}

export const BIBLE_STUDY_RETRY_PREFIX = "bible-study-retry:";

export const BIBLE_STUDY_RESUME_COMMANDS = ["/重试", "继续", "继续。", "继续！", "继续!"] as const;

export function isBibleStudyResumeCommand(text: string) {
  return BIBLE_STUDY_RESUME_COMMANDS.some(command => command === text);
}

export const BIBLE_STUDY_STAGE_DETAILS: Record<BibleStudyStage, { label: string; goal: string }> = {
  observe: { label: "观察经文", goal: "找出经文里的关键细节，并指出你是从哪一节看出来的。" },
  interpret: { label: "理解原意", goal: "用刚才找到的细节，说明这段经文想表达什么。" },
  gospel: { label: "联系福音", goal: "说清这段经文怎样让你认识神，以及它与基督的救恩有什么关系。" },
  situation: { label: "具体处境", goal: "找出一件真实或假设的事，说明自己平时怎样理解或回应。" },
  grace: { label: "回应恩典", goal: "说清基督的恩典怎样改变你对这件事的看法和反应。" },
  response: { label: "实践选择", goal: "选一个下次遇到类似处境时，能实际采取的行动。" }
};

export const BIBLE_STUDY_RELATIONS = ["opening", "deepen", "new_angle", "hint", "return", "advance", "earlier"] as const;
export type BibleStudyRelation = typeof BIBLE_STUDY_RELATIONS[number];

export interface BibleStudyQuestion {
  id: number;
  number?: number;
  siblingNumber?: number;
  skipped?: boolean;
  stage: BibleStudyStage;
  text: string;
  purpose: string;
  relation: BibleStudyRelation;
  parentId?: number;
  returnToId?: number;
  evidence: string[];
}

export const BIBLE_STUDY_RELATION_LABELS: Record<BibleStudyRelation, string> = {
  opening: "开始观察", deepen: "接着追问", new_angle: "换个观察角度", hint: "把原题拆小",
  return: "回到原题", advance: "进入新阶段", earlier: "已有提问"
};

export interface BibleStudyAnswer {
  id: number;
  questionId: number;
  text: string;
  response?: string;
}

export interface BibleStudyAnswerRequest {
  questionId: number;
  content: string;
  mode: "answer" | "followup";
  clientRequestId: string;
  evidence?: string;
}

/** Only descendants of this question, never later siblings or independent questions. */
export function bibleStudyBranchIds(questions: BibleStudyQuestion[], questionId: number): number[] {
  if (!questions.some(question => question.id === questionId)) return [];
  const children = new Map<number, number[]>();
  for (const question of questions) {
    if (question.parentId) children.set(question.parentId, [...(children.get(question.parentId) ?? []), question.id]);
  }
  const seen = new Set<number>();
  const pending = [questionId];
  while (pending.length) {
    const id = pending.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    pending.push(...(children.get(id) ?? []));
  }
  return [...seen].sort((a, b) => a - b);
}
