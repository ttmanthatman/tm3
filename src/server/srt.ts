import type { MusicLyricCueDTO } from "../shared/types.js";

const TIMESTAMP_PATTERN = /^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})$/;

function timestampMs(value: string) {
  const match = TIMESTAMP_PATTERN.exec(value.trim());
  if (!match) return null;
  const [, hours, minutes, seconds, milliseconds] = match;
  if (Number(minutes) > 59 || Number(seconds) > 59) return null;
  return ((Number(hours) * 60 * 60 + Number(minutes) * 60 + Number(seconds)) * 1000) + Number(milliseconds);
}

export function parseSrt(input: string): MusicLyricCueDTO[] {
  const normalized = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  const cues: MusicLyricCueDTO[] = [];
  for (const block of normalized.split(/\n{2,}/)) {
    const lines = block.split("\n").map((line) => line.trimEnd());
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const [rawStart, rawEndWithSettings] = lines[timingIndex].split(/\s+-->\s+/, 2);
    const rawEnd = rawEndWithSettings?.split(/\s+/, 1)[0] || "";
    const startMs = timestampMs(rawStart || "");
    const endMs = timestampMs(rawEnd);
    const text = lines.slice(timingIndex + 1).join("\n").trim();
    if (startMs === null || endMs === null || endMs <= startMs || !text) continue;
    const requestedIndex = Number(lines[0]);
    cues.push({
      index: Number.isInteger(requestedIndex) && requestedIndex > 0 ? requestedIndex : cues.length + 1,
      startMs,
      endMs,
      text
    });
    if (cues.length >= 5000) break;
  }
  return cues.sort((left, right) => left.startMs - right.startMs || left.index - right.index);
}

const LRC_TIME_PATTERN = /^(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?$/;
const LRC_LINE_TIME_PATTERN = /\[(\d{1,3}:\d{2}(?:[.:]\d{1,3})?)\]/g;
const LRC_DETECTION_PATTERN = /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/;
const ENHANCED_LRC_TIME_PATTERN = /<(\d{1,3}:\d{2}(?:[.:]\d{1,3})?)>/g;

function lrcTimestampMs(value: string) {
  const match = LRC_TIME_PATTERN.exec(value.trim());
  if (!match) return null;
  const [, minutes, seconds, fraction = "0"] = match;
  if (Number(seconds) > 59) return null;
  const milliseconds = Number(fraction.padEnd(3, "0").slice(0, 3));
  return (Number(minutes) * 60 + Number(seconds)) * 1000 + milliseconds;
}

type RawLrcCue = {
  startMs: number;
  text: string;
  segments?: Array<{ startMs: number; text: string }>;
};

function enhancedSegments(text: string, offsetMs: number) {
  const matches = [...text.matchAll(ENHANCED_LRC_TIME_PATTERN)];
  if (!matches.length) return null;
  const segments: Array<{ startMs: number; text: string }> = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const startMs = lrcTimestampMs(match[1]);
    const segmentText = text.slice((match.index || 0) + match[0].length, matches[index + 1]?.index ?? text.length);
    if (startMs !== null && segmentText) segments.push({ startMs: Math.max(0, startMs + offsetMs), text: segmentText });
  }
  return segments.length ? segments : null;
}

export function parseLrc(input: string): MusicLyricCueDTO[] {
  LRC_LINE_TIME_PATTERN.lastIndex = 0;
  const normalized = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const offsetMs = Number(/^\s*\[offset:([+-]?\d+)\]\s*$/im.exec(normalized)?.[1] || 0);
  const rawCues: RawLrcCue[] = [];
  for (const line of normalized.split("\n")) {
    const times = [...line.matchAll(LRC_LINE_TIME_PATTERN)]
      .map((match) => lrcTimestampMs(match[1]))
      .filter((value): value is number => value !== null);
    if (!times.length) continue;
    const lyricPart = line.replace(LRC_LINE_TIME_PATTERN, "").trim();
    if (!lyricPart) continue;
    const rawSegments = enhancedSegments(lyricPart, offsetMs);
    const text = rawSegments ? rawSegments.map((segment) => segment.text).join("").trim() : lyricPart;
    if (!text) continue;
    for (const time of times) {
      rawCues.push({ startMs: Math.max(0, time + offsetMs), text, ...(rawSegments ? { segments: rawSegments } : {}) });
    }
  }
  rawCues.sort((left, right) => left.startMs - right.startMs);
  return rawCues.slice(0, 5000).map((cue, index) => {
    const nextStart = rawCues[index + 1]?.startMs;
    const endMs = nextStart !== undefined && nextStart > cue.startMs ? nextStart : cue.startMs + 5000;
    const segments = cue.segments
      ?.filter((segment) => segment.startMs >= cue.startMs && segment.startMs < endMs)
      .map((segment, segmentIndex, all) => ({
        startMs: segment.startMs,
        endMs: Math.max(segment.startMs + 1, all[segmentIndex + 1]?.startMs ?? endMs),
        text: segment.text
      }));
    return {
      index: index + 1,
      startMs: cue.startMs,
      endMs,
      text: cue.text,
      ...(segments?.length ? { segments } : {})
    };
  });
}

export function parseLyrics(input: string, fileName = "") {
  if (/\.lrc$/i.test(fileName) || (!/-->/.test(input) && LRC_DETECTION_PATTERN.test(input))) return parseLrc(input);
  return parseSrt(input);
}
