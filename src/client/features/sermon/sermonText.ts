import type { SermonAnnotation, SermonAnnotationKind } from "@shared/types";

export type SermonTextSegment = {
  text: string;
  kinds: SermonAnnotationKind[];
};

/**
 * 把一节经文按标注切分成渲染片段。start/end 是节内纯文本字符偏移
 * （[start, end) 区间），缺省表示整节。越界或不完整的标注被安全地
 * 裁剪/忽略，同一片段可同时带高亮和划线。
 */
export function verseAnnotationSegments(text: string, annotations: SermonAnnotation[]): SermonTextSegment[] {
  if (!text) return [];
  const normalized = annotations
    .map((annotation) => {
      const start = annotation.start === undefined ? 0 : Math.max(0, Math.min(text.length, Math.floor(annotation.start)));
      const end = annotation.end === undefined ? text.length : Math.max(0, Math.min(text.length, Math.floor(annotation.end)));
      return start < end ? { start, end, kind: annotation.kind } : null;
    })
    .filter((annotation): annotation is { start: number; end: number; kind: SermonAnnotationKind } => !!annotation);
  if (!normalized.length) return [{ text, kinds: [] }];
  const boundaries = new Set<number>([0, text.length]);
  for (const annotation of normalized) {
    boundaries.add(annotation.start);
    boundaries.add(annotation.end);
  }
  const points = [...boundaries].sort((a, b) => a - b);
  const segments: SermonTextSegment[] = [];
  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index];
    const end = points[index + 1];
    if (start >= end) continue;
    const kinds: SermonAnnotationKind[] = [];
    for (const annotation of normalized) {
      if (annotation.start <= start && annotation.end >= end && !kinds.includes(annotation.kind)) kinds.push(annotation.kind);
    }
    const piece = text.slice(start, end);
    const last = segments[segments.length - 1];
    if (last && last.kinds.length === kinds.length && last.kinds.every((kind) => kinds.includes(kind))) {
      last.text += piece;
    } else {
      segments.push({ text: piece, kinds });
    }
  }
  return segments;
}

/** 一节经文上某类标注是否已覆盖（用于讲道台点按切换）。 */
export function verseHasAnnotation(annotations: SermonAnnotation[], verseIndex: number, kind: SermonAnnotationKind) {
  return annotations.some((annotation) => annotation.verseIndex === verseIndex && annotation.kind === kind);
}

export function annotationsForVerse(annotations: SermonAnnotation[], verseIndex: number) {
  return annotations.filter((annotation) => annotation.verseIndex === verseIndex);
}

/** 讲道台输入的一串出处：按逗号/分号/换行（含全角）拆分并去重。 */
export function splitSermonReferences(input: string): string[] {
  const seen = new Set<string>();
  const references: string[] = [];
  for (const piece of input.split(/[,，;；、\n\r]+/)) {
    const reference = piece.trim();
    if (!reference || seen.has(reference)) continue;
    seen.add(reference);
    references.push(reference);
  }
  return references;
}

/** 自由文字条目正文：按空行拆成段落（段内保留单换行），空段落忽略。 */
export function splitSermonTextParagraphs(content: string): string[] {
  return content
    .split(/\n[ \t]*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}
