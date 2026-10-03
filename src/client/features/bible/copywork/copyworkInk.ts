import type { HandwritingCharacter } from "@shared/handwriting";
import type { InkBounds } from "@shared/bibleCopywork";
import { drawHandwritingInk } from "../../handwriting/handwritingRenderer";
const cache = new WeakMap<HandwritingCharacter, InkBounds>();
/** Sample rendered alpha, including brush footprint and caps, with a generous overscan. */
export function measureCopyworkInk(character: HandwritingCharacter): InkBounds {
  const cached = cache.get(character);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1024;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前浏览器无法绘制笔迹");
  const scale = 1024 / 20000;
  context.setTransform(scale, 0, 0, scale, 256, 256);
  drawHandwritingInk(context, character);
  const data = context.getImageData(0, 0, 1024, 1024).data;
  let left = 1024;
  let right = -1;
  let top = 1024;
  let bottom = -1;
  for (let y = 0; y < 1024; y++)
    for (let x = 0; x < 1024; x++) {
      if (data[(y * 1024 + x) * 4 + 3] > 0) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  if (right < 0) throw new Error("请先写下这个字");
  const bounds = {
    left: (left - 256) / scale,
    top: (top - 256) / scale,
    right: (right + 1 - 256) / scale,
    bottom: (bottom + 1 - 256) / scale
  };
  cache.set(character, bounds);
  return bounds;
}
