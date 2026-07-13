import assert from "node:assert/strict";
import test from "node:test";
import { mergeAudioWaveformPayload, waveformFromGrayFrame } from "./audioWaveform.js";

function grayWaveformFrame(columnHeights: number[], height = 16) {
  const buffer = Buffer.alloc(columnHeights.length * height);
  columnHeights.forEach((columnHeight, x) => {
    for (let y = 0; y < columnHeight; y += 1) {
      buffer[y * columnHeights.length + x] = 255;
    }
  });
  return buffer;
}

test("server waveform-frame analysis returns normalized bars shaped by the decoded audio", () => {
  const waveform = waveformFromGrayFrame(grayWaveformFrame([2, 5, 9, 16]), 4, 16);

  assert.equal(waveform.length, 4);
  assert.ok(waveform[0] < waveform[1]);
  assert.ok(waveform[1] < waveform[2]);
  assert.ok(waveform[2] < waveform[3]);
  assert.equal(waveform[3], 1);
});

test("computed audio waveform is merged without converting the attachment into a voice message", () => {
  assert.deepEqual(mergeAudioWaveformPayload({ effect: "shine" }, [0.2, 0.8]), {
    effect: "shine",
    kind: "audio",
    waveform: [0.2, 0.8]
  });
});
