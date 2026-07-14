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
