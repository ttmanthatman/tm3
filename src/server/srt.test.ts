import assert from "node:assert/strict";
import test from "node:test";
import { parseSrt } from "./srt.js";

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
