import assert from "node:assert/strict";
import test from "node:test";
import type { MessageDTO } from "@shared/types";
import { revealedTranscriptWords, voiceTranscriptWords } from "./voiceTranscriptTiming";

const words = [
  { text: "你好，", beginMs: 300, endMs: 700 },
  { text: "世界。", beginMs: 1100, endMs: 1600 }
];
test("subtitle reveal respects silence and seeking backwards rather than wall-clock time", () => {
  assert.deepEqual(revealedTranscriptWords(words, 299), []);
  assert.deepEqual(revealedTranscriptWords(words, 300), [words[0]]);
  assert.deepEqual(revealedTranscriptWords(words, 1000), [words[0]]);
  assert.deepEqual(revealedTranscriptWords(words, 1200), words);
  assert.deepEqual(revealedTranscriptWords(words, 400), [words[0]]);
  assert.deepEqual(revealedTranscriptWords(words, 0), []);
  assert.deepEqual(revealedTranscriptWords(words, NaN), []);
});
test("legacy or malformed timing falls back to the saved plain transcript", () => {
  const message = (payload: unknown) => ({ payload }) as MessageDTO;
  assert.deepEqual(voiceTranscriptWords(message({ kind: "voice", transcript: "旧文字" })), []);
  assert.deepEqual(voiceTranscriptWords(message({ kind: "voice", transcriptWords: [{ text: "错", beginMs: 2, endMs: 1 }] })), []);
  assert.deepEqual(voiceTranscriptWords(message({ kind: "audio", transcriptWords: words })), []);
  assert.deepEqual(voiceTranscriptWords(message({ kind: "voice", transcriptWords: [...words].reverse() })), words);
});
