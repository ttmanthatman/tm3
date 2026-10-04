import { expect, test } from "@playwright/test";

test("both brush algorithms fill their swept envelope without internal seams or hollow end nibs", async ({ page }) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const rendererPath = "/src/client/features/handwriting/handwritingRenderer.ts";
    const geometryPath = "/src/client/features/handwriting/handwritingBrush.ts";
    const renderer = await import(rendererPath) as typeof import("../../src/client/features/handwriting/handwritingRenderer");
    const { handwritingBrushGeometry } = await import(geometryPath) as typeof import("../../src/client/features/handwriting/handwritingBrush");
    const canvas = () => {
      const element = document.createElement("canvas");
      element.width = element.height = 600;
      return element;
    };
    const results = [];
    for (const algorithm of ["follow", "slanted"] as const) {
      const stroke = {
        color: "#6930e9" as const,
        brush: { size: 100, sensitivity: 30, lag: 70, rotationLag: 35, algorithm, version: 2 as const },
        points: Array.from({ length: 45 }, (_, i) => [2200 + i * 100, 4800 + Math.sin(i / 9) * 2200, i * 20] as [number, number, number])
      };
      for (const count of [20, stroke.points.length]) {
        const prefix = { ...stroke, points: stroke.points.slice(0, count) };
        const mask = canvas();
        const maskContext = mask.getContext("2d")!;
        maskContext.setTransform(0.06, 0, 0, 0.06, 0, 0);
        // Independent union of the actual nib footprints: every interior pixel
        // swept by the brush must remain ink in every rendering entry point.
        for (const sample of handwritingBrushGeometry(prefix).samples) {
          maskContext.beginPath();
          renderer.traceBrushFootprintPath(maskContext, sample);
          maskContext.fill();
        }
        const replay = canvas();
        renderer.drawHandwritingCharacter(replay, { strokes: [stroke] }, { maxDevicePixelRatio: 1, visiblePointCounts: [count] });
        const live = canvas();
        const liveStroke = { ...stroke, points: [] as [number, number, number][] };
        for (const point of prefix.points) {
          const start = liveStroke.points.length;
          liveStroke.points.push(point);
          renderer.appendHandwritingStroke(live, liveStroke, start, { maxDevicePixelRatio: 1 });
        }
        const ink = canvas();
        ink.getContext("2d")!.setTransform(0.06, 0, 0, 0.06, 0, 0);
        renderer.drawHandwritingInk(ink.getContext("2d")!, { strokes: [prefix] });
        const expected = maskContext.getImageData(0, 0, 600, 600).data;
        for (const [mode, rendered] of [["replay", replay], ["live", live], ["copywork", ink]] as const) {
          const actual = rendered.getContext("2d")!.getImageData(0, 0, 600, 600).data;
          let holes = 0;
          let interior = 0;
          for (let y = 2; y < 598; y++) for (let x = 2; x < 598; x++) {
            let inside = true;
            // Exclude the antialiased outer edge, while detecting subpixel
            // white seams and the hollow waterdrop at the completed stroke end.
            for (let dy = -2; dy <= 2 && inside; dy++) for (let dx = -2; dx <= 2; dx++) {
              if (expected[((y + dy) * 600 + x + dx) * 4 + 3] !== 255) { inside = false; break; }
            }
            if (inside) {
              interior++;
              if (actual[(y * 600 + x) * 4 + 3] < 250) holes++;
            }
          }
          results.push({ algorithm, count, mode, holes, interior });
        }
      }
    }
    return results;
  });
  for (const result of results) {
    expect(result.interior, JSON.stringify(result)).toBeGreaterThan(1000);
    expect(result.holes, JSON.stringify(result)).toBe(0);
  }
});
