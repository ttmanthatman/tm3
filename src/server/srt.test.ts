import assert from "node:assert/strict";
import test from "node:test";
import { parseLyrics, parseSrt } from "./srt.js";

test("parses BOM, CRLF, Chinese text and multiline SRT cues", () => {
  assert.deepEqual(
    parseSrt("\uFEFF1\r\n00:00:01,250 --> 00:00:03,500\r\n第一句\r\n第二行\r\n\r\n2\r\n00:00:04.000 --> 00:00:06.250 position:50%\r\n下一句\r\n"),
    [
      { index: 1, startMs: 1250, endMs: 3500, text: "第一句\n第二行" },
      { index: 2, startMs: 4000, endMs: 6250, text: "下一句" }
    ]
  );
});

test("rejects malformed, empty and backwards cues", () => {
  assert.deepEqual(parseSrt("bad\n\n1\n00:00:03,000 --> 00:00:02,000\n倒序\n\n2\n00:00:04,000 --> 00:00:05,000\n\n"), []);
});

test("parses standard LRC timestamps, repeated lines and global offset", () => {
  const cues = parseLyrics("[offset:250]\n[00:01.00][00:05.00]同一句\n[00:08.50]下一句", "song.lrc");
  assert.deepEqual(cues, [
    { index: 1, startMs: 1250, endMs: 5250, text: "同一句" },
    { index: 2, startMs: 5250, endMs: 8750, text: "同一句" },
    { index: 3, startMs: 8750, endMs: 13750, text: "下一句" }
  ]);
});

test("parses Enhanced LRC word timing for progressive karaoke color", () => {
  const cues = parseLyrics("[00:01.00]<00:01.00>耶<00:01.50>和<00:02.00>华\n[00:03.00]下一句", "song.lrc");
  assert.deepEqual(cues, [
    {
      index: 1,
      startMs: 1000,
      endMs: 3000,
      text: "耶和华",
      segments: [
        { startMs: 1000, endMs: 1500, text: "耶" },
        { startMs: 1500, endMs: 2000, text: "和" },
        { startMs: 2000, endMs: 3000, text: "华" }
      ]
    },
    { index: 2, startMs: 3000, endMs: 8000, text: "下一句" }
  ]);
});
