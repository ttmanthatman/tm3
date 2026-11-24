import type { BibleStudyQuestion } from "@shared/bibleStudy";

export function studyQuestionTree(questions: BibleStudyQuestion[]) {
  const ordered = [...questions].sort((a, b) => a.id - b.id);
  const byId = new Map(ordered.map(question => [question.id, question]));
  const labels = new Map<number, string>();
  const rootNumbers = new Map(ordered.map((question, index) => [question.id, `Q${index + 1}`]));
  const paths = new Map<number, string>();
  const children = new Map<number | undefined, BibleStudyQuestion[]>();
  for (const question of ordered) {
    const parent = question.parentId && byId.has(question.parentId) && question.parentId < question.id ? question.parentId : undefined;
    const siblings = children.get(parent) ?? [];
    siblings.push(question);
    children.set(parent, siblings);
  }
  const rows: Array<{ question: BibleStudyQuestion; label: string; parentLabel?: string; depth: number }> = [];
  const pending = (children.get(undefined) ?? []).map(question => ({ question, depth: 0 })).reverse();
  while (pending.length) {
    const { question, depth } = pending.pop()!;
    const parentPath = paths.get(question.parentId ?? 0);
    const siblings = children.get(parentPath ? question.parentId : undefined) ?? [];
    const path = parentPath ? `${parentPath}:${siblings.indexOf(question) + 1}` : rootNumbers.get(question.id)!;
    paths.set(question.id, path);
    const label = parentPath ? `追问${path}` : path;
    labels.set(question.id, label);
    rows.push({ question, label, parentLabel: parentPath ? labels.get(question.parentId!) : undefined, depth });
    for (const child of [...(children.get(question.id) ?? [])].reverse()) pending.push({ question: child, depth: depth + 1 });
  }
  return { rows, labels, byId };
}

export function studyQuestionAncestors(questions: BibleStudyQuestion[], id?: number) {
  const byId = new Map(questions.map(question => [question.id, question]));
  const ancestors: BibleStudyQuestion[] = [];
  const seen = new Set<number>();
  let parent = byId.get(id ?? 0)?.parentId;
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    const question = byId.get(parent);
    if (!question) break;
    ancestors.unshift(question);
    parent = question.parentId;
  }
  return ancestors;
}
