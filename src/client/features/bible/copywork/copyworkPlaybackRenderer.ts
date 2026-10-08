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
  const pending = new Map<InkImage, Generator<void>>();
  const rasterKey = {};
  let raster: HTMLCanvasElement | null = null;
  let latest: Map<number, number[]> | undefined;
  let revision = 0;
  let frame: { revision: number; images: InkImage[]; wanted: Set<string> } | null = null;
  let size = "";

  function cancel() {
    handwritingRenderQueue.cancel(rasterKey);
    for (const image of pending.keys()) {
      for (const [key, value] of images) if (value === image) images.delete(key);
    }
    pending.clear();
    raster = null;
    frame = null;
    const canvas = deps.canvas();
    if (canvas) handwritingRenderQueue.cancel(canvas);
  }
  function reset() {
    cancel();
    images.clear();
    size = "";
  }
  function schedule() {
    const canvas = deps.canvas();
    if (canvas && deps.active()) handwritingRenderQueue.enqueue(canvas, render);
  }
  function rasterize() {
    if (!deps.active()) return;
    const job = pending.entries().next().value;
    if (!job) return;
    const [image, drawing] = job;
    if (drawing.next().done) {
      image.ready = true;
      pending.delete(image);
      schedule();
    }
    if (pending.size) handwritingRenderQueue.enqueue(rasterKey, rasterize);
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
    if (!frame) {
      frame = { revision, images: [], wanted: new Set<string>() };
      const glyphs = new Map(deps.glyphs().map((glyph) => [glyph.index, glyph]));
      for (const placement of deps.placements()) {
        const glyph = glyphs.get(placement.index);
        if (!glyph) continue;
        const counts = latest?.get(glyph.index) || (latest ? glyph.character.strokes.map(() => 0) : undefined);
        if (counts?.every((count) => count === 0)) continue;
        const full = !counts || counts.every((count, i) => count >= glyph.character.strokes[i].points.length);
        const key = `${glyph.index}:${full ? "full" : counts!.join(",")}`;
        frame.wanted.add(key);
        let image = images.get(key);
        if (!image) {
          // Keep compact glyph caches, but trace on one reusable page surface.
          // Rebased transforms on small canvases change Chromium's brush edge
          // coverage even at integer offsets. Crop only after page rasterization.
          const originX = (placement.x - view.x) * scale;
          const originY = (placement.y - view.y) * scale;
          const left = Math.floor(originX + glyph.bounds.left * inkScale) - 1;
          const top = Math.floor(originY + glyph.bounds.top * inkScale) - 1;
          const buffer = document.createElement("canvas");
          buffer.width = Math.max(1, Math.ceil(originX + glyph.bounds.right * inkScale) - left + 1);
          buffer.height = Math.max(1, Math.ceil(originY + glyph.bounds.bottom * inkScale) - top + 1);
          const cachedInk = buffer.getContext("2d");
          if (!cachedInk) continue;
          const character = glyph.character;
          image = { canvas: buffer, left, top, ready: false };
          images.set(key, image);
          function* drawInk() {
            raster ||= document.createElement("canvas");
            if (raster.width !== width || raster.height !== height) {
              raster.width = width;
              raster.height = height;
            }
            const ink = raster.getContext("2d");
            if (!ink) return;
            ink.setTransform(1, 0, 0, 1, 0, 0);
            ink.clearRect(0, 0, width, height);
            ink.scale(scale, scale);
            ink.translate(-view.x, -view.y);
            ink.translate(placement.x, placement.y);
            ink.scale(COPYWORK_PAGE.font / 10000, COPYWORK_PAGE.font / 10000);
            yield* drawHandwritingInkSteps(ink, character, full ? undefined : counts);
            cachedInk!.drawImage(raster, -left, -top);
          }
          pending.set(image, drawInk());
          handwritingRenderQueue.enqueue(rasterKey, rasterize);
        }
        frame.images.push(image);
      }
    }
    // Keep the previous visible frame until every glyph in this snapshot is
    // ready. New progress waits for this snapshot instead of cancelling its
    // brush rasterization, so dense strokes still advance under frame pressure.
    if (frame.images.some((image) => !image.ready)) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    for (const image of frame.images) ctx.drawImage(image.canvas, image.left, image.top);
    for (const [key, image] of images) {
      if (!key.endsWith(":full") && !frame.wanted.has(key)) {
        pending.delete(image);
        images.delete(key);
      }
    }
    const renderedRevision = frame.revision;
    frame = null;
    if (renderedRevision !== revision) schedule();
  }
  return {
    draw(counts?: Map<number, number[]>) {
      latest = counts ? new Map([...counts].map(([index, values]) => [index, [...values]])) : undefined;
      revision++;
      schedule();
    },
    cancel,
    reset,
    destroy: reset
  };
}
