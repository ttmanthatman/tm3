import { COPYWORK_PAGE, type CopyworkGlyph, type CopyworkPlacement } from "@shared/bibleCopywork";
import { drawHandwritingInkSteps } from "../../handwriting/handwritingRenderer";
import { handwritingRenderQueue } from "../../handwriting/handwritingRenderQueue";

type Glyph = CopyworkGlyph & { index: number };
type Viewport = { x: number; y: number; width: number; height: number };
type InkImage = { canvas: HTMLCanvasElement; left: number; top: number; ready: boolean };

// Full glyphs keep their raster when seeking backwards. Only the changing
// glyph is traced again; each dense path yields to the shared frame budget.
export function createCopyworkPlaybackRenderer(deps: {
  canvas: () => HTMLCanvasElement | null;
  viewport: () => Viewport;
  glyphs: () => Glyph[];
  placements: () => CopyworkPlacement[];
  active: () => boolean;
}) {
  const images = new Map<string, InkImage>();
  const pending = new Set<InkImage>();
  let latest: Map<number, number[]> | undefined;
  let size = "";
  let generation = 0;

  function cancel() {
    for (const image of pending) {
      handwritingRenderQueue.cancel(image);
      for (const [key, value] of images) if (value === image) images.delete(key);
    }
    pending.clear();
    const canvas = deps.canvas();
    if (canvas) handwritingRenderQueue.cancel(canvas);
  }
  function reset() {
    generation++;
    cancel();
    images.clear();
    size = "";
  }
  function schedule() {
    const canvas = deps.canvas();
    if (canvas && deps.active()) handwritingRenderQueue.enqueue(canvas, render);
  }
  function render() {
    const canvas = deps.canvas();
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !deps.active()) return;
    const view = deps.viewport();
    const width = Math.max(1, Math.round(canvas.getBoundingClientRect().width * Math.min(window.devicePixelRatio || 1, 2)));
    const height = Math.max(1, Math.round(width * view.height / view.width));
    const nextSize = `${width}:${height}:${view.x}:${view.y}:${view.width}`;
    if (size !== nextSize) {
      reset();
      size = nextSize;
      canvas.width = width;
      canvas.height = height;
    }
    const scale = width / view.width;
    const inkScale = scale * COPYWORK_PAGE.font / 10000;
    const glyphs = new Map(deps.glyphs().map((glyph) => [glyph.index, glyph]));
    const wanted = new Set<string>();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    for (const placement of deps.placements()) {
      const glyph = glyphs.get(placement.index);
      if (!glyph) continue;
      const counts = latest?.get(glyph.index) || (latest ? glyph.character.strokes.map(() => 0) : undefined);
      if (counts?.every((count) => count === 0)) continue;
      const full = !counts || counts.every((count, i) => count >= glyph.character.strokes[i].points.length);
      const key = `${glyph.index}:${full ? "full" : counts!.join(",")}`;
      wanted.add(key);
      let image = images.get(key);
      if (!image) {
        // Rasterize at the final page's pixel phase, then copy at integer pixels.
        // Fractional drawImage positions would smooth the ink a second time.
        const originX = (placement.x - view.x) * scale;
        const originY = (placement.y - view.y) * scale;
        const left = Math.floor(originX + glyph.bounds.left * inkScale) - 1;
        const top = Math.floor(originY + glyph.bounds.top * inkScale) - 1;
        const buffer = document.createElement("canvas");
        buffer.width = Math.max(1, Math.ceil(originX + glyph.bounds.right * inkScale) - left + 1);
        buffer.height = Math.max(1, Math.ceil(originY + glyph.bounds.bottom * inkScale) - top + 1);
        const ink = buffer.getContext("2d");
        if (!ink) continue;
        ink.translate(-left, -top);
        ink.scale(scale, scale);
        ink.translate(-view.x, -view.y);
        ink.translate(placement.x, placement.y);
        ink.scale(COPYWORK_PAGE.font / 10000, COPYWORK_PAGE.font / 10000);
        image = { canvas: buffer, left, top, ready: false };
        images.set(key, image);
        pending.add(image);
        const target = image;
        const request = generation;
        const drawing = drawHandwritingInkSteps(ink, glyph.character, full ? undefined : counts);
        const step = () => {
          if (request !== generation || !deps.active()) return;
          if (!drawing.next().done) handwritingRenderQueue.enqueue(target, step);
          else {
            target.ready = true;
            pending.delete(target);
            schedule();
          }
        };
        handwritingRenderQueue.enqueue(target, step);
      }
      if (image.ready) ctx.drawImage(image.canvas, image.left, image.top);
    }
    for (const [key, image] of images) {
      if (!key.endsWith(":full") && !wanted.has(key)) {
        handwritingRenderQueue.cancel(image);
        pending.delete(image);
        images.delete(key);
      }
    }
  }
  return {
    draw(counts?: Map<number, number[]>) {
      latest = counts ? new Map([...counts].map(([index, values]) => [index, [...values]])) : undefined;
      schedule();
    },
    cancel,
    reset,
    destroy: reset
  };
}
