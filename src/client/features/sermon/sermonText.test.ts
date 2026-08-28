import assert from "node:assert/strict";
import test from "node:test";
import type { SermonAnnotation } from "../../../shared/types.js";
import { annotationsForVerse, splitSermonTextParagraphs, verseAnnotationSegments, verseHasAnnotation } from "./sermonText.js";

test("无标注时整节为单个无标注片段", () => {
  assert.deepEqual(verseAnnotationSegments("神爱世人", []), [{ text: "神爱世人", kinds: [] }]);
  assert.deepEqual(verseAnnotationSegments("", []), []);
});

test("整节标注（缺省 start/end）覆盖整节", () => {
  const segments = verseAnnotationSegments("神爱世人", [{ verseIndex: 0, kind: "highlight" }]);
  assert.deepEqual(segments, [{ text: "神爱世人", kinds: ["highlight"] }]);
});

test("选段标注按字符偏移切分并合并相邻同标注片段", () => {
  const annotations: SermonAnnotation[] = [
    { verseIndex: 0, kind: "underline", start: 1, end: 3 },
    { verseIndex: 0, kind: "underline", start: 3, end: 4 }
  ];
  assert.deepEqual(verseAnnotationSegments("神爱世人，甚至", annotations), [
    { text: "神", kinds: [] },
    { text: "爱世人", kinds: ["underline"] },
    { text: "，甚至", kinds: [] }
  ]);
});

test("同一片段可同时带高亮与划线，重叠区间正确相交", () => {
  const annotations: SermonAnnotation[] = [
    { verseIndex: 0, kind: "highlight", start: 0, end: 2 },
    { verseIndex: 0, kind: "underline", start: 1, end: 3 }
  ];
  assert.deepEqual(verseAnnotationSegments("神爱世人", annotations), [
    { text: "神", kinds: ["highlight"] },
    { text: "爱", kinds: ["highlight", "underline"] },
    { text: "世", kinds: ["underline"] },
    { text: "人", kinds: [] }
  ]);
});

test("越界与反向区间被安全裁剪或忽略", () => {
  const annotations: SermonAnnotation[] = [
    { verseIndex: 0, kind: "highlight", start: -5, end: 99 },
    { verseIndex: 0, kind: "underline", start: 3, end: 1 },
    { verseIndex: 0, kind: "underline", start: 2, end: 2 }
  ];
  assert.deepEqual(verseAnnotationSegments("神爱世人", annotations), [{ text: "神爱世人", kinds: ["highlight"] }]);
});

test("verseHasAnnotation 与 annotationsForVerse 按节与类型过滤", () => {
  const annotations: SermonAnnotation[] = [
    { verseIndex: 0, kind: "highlight" },
    { verseIndex: 1, kind: "underline", start: 0, end: 2 }
  ];
  assert.equal(verseHasAnnotation(annotations, 0, "highlight"), true);
  assert.equal(verseHasAnnotation(annotations, 0, "underline"), false);
  assert.equal(annotationsForVerse(annotations, 1).length, 1);
  assert.equal(annotationsForVerse(annotations, 2).length, 0);
});

test("splitSermonTextParagraphs 按空行分段并忽略空段", () => {
  assert.deepEqual(splitSermonTextParagraphs("第一段\n\n第二段\n\n\n第三段"), ["第一段", "第二段", "第三段"]);
  assert.deepEqual(splitSermonTextParagraphs("段内\n换行保留"), ["段内\n换行保留"]);
  assert.deepEqual(splitSermonTextParagraphs(" \n\n "), []);
});
