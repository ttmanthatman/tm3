import { expect, test, webkit } from "@playwright/test";
import type * as BrushModule from "../../src/client/features/handwriting/handwritingBrush.js";
import type * as RendererModule from "../../src/client/features/handwriting/handwritingRenderer.js";
import type * as ShapeModule from "../../src/client/features/handwriting/handwritingTrueBrush.js";
import type { HandwritingStroke } from "../../src/shared/handwriting.js";

test("true brush folded frontier deposits ink and raster replay agrees in Chromium and WebKit", async ({ page }) => {
  test.setTimeout(60000);
  const safari = await webkit.launch();
  const safariPage = await safari.newPage();
  try {
    for (const [name, target] of [["chromium", page], ["webkit", safariPage]] as const) {
      await target.goto("/");
      const result = await target.evaluate(async () => {
        const brushPath = "/src/client/features/handwriting/handwritingBrush.ts";
        const rendererPath = "/src/client/features/handwriting/handwritingRenderer.ts";
        const shapePath = "/src/client/features/handwriting/handwritingTrueBrush.ts";
        const { handwritingBrushGeometry } = await import(brushPath) as typeof BrushModule;
        const { drawHandwritingCharacter, appendHandwritingStroke, traceBrushFootprintPath } = await import(rendererPath) as typeof RendererModule;
        const { beginTrueBrushFold, retargetTrueBrushFold, trueBrushCrease, trueBrushFoldNormal, reflectFoldPoint } = await import(shapePath) as typeof ShapeModule;
        const stroke: HandwritingStroke = {
          brush: { size: 84, sensitivity: 50, lag: 0, algorithm: "true-v1", rotationLag: 35, version: 2, pauseThresholdMs: 200, pausedRotationScale: 0.1 },
          points: Array.from({ length: 31 }, (_, i) => [1500 + i * 120, 3500, i * 8])
        };
        stroke.points.push([5100, 3500, 540]);
        for (let i = 1; i <= 24; i++) stroke.points.push([Math.round(5100 - i * 80 * Math.cos(Math.PI / 6)), 3500 + i * 40, 540 + i * 16]);
        const geometry = handwritingBrushGeometry(stroke);
        const makeCanvas = () => { const canvas = document.createElement("canvas"); canvas.width = 1200; canvas.height = 1200; return canvas; };
        const mask = (canvas: HTMLCanvasElement) => {
          const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
          return Uint8Array.from({ length: canvas.width * canvas.height }, (_, i) => data[i * 4 + 3] > 120 ? 1 : 0);
        };
        const live = makeCanvas();
        const liveStroke = { ...stroke, points: [] as HandwritingStroke["points"] };
        for (const point of stroke.points) {
          const start = liveStroke.points.length;
          liveStroke.points.push(point);
          appendHandwritingStroke(live, liveStroke, start);
        }
        const replay = makeCanvas();
        drawHandwritingCharacter(replay, { strokes: [stroke] });
        const liveMask = mask(live);
        const replayMask = mask(replay);
        const mismatches = liveMask.reduce((sum, value, i) => sum + Number(value !== replayMask[i]), 0);
        const inkPixels = replayMask.reduce((sum, value) => sum + value, 0);
        const initialFoldIndex = geometry.ends.findIndex((end) => geometry.samples[end - 1].fold);
        const midFoldIndex = geometry.ends.findIndex((end) => { const fold = geometry.samples[end - 1].fold; return fold && fold.travel > fold.distance * 0.65; });
        const before = makeCanvas();
        const after = makeCanvas();
        drawHandwritingCharacter(before, { strokes: [stroke] }, { visiblePointCounts: [initialFoldIndex + 1] });
        drawHandwritingCharacter(after, { strokes: [stroke] }, { visiblePointCounts: [midFoldIndex + 1] });
        const beforeMask = mask(before);
        const afterMask = mask(after);
        const newPixels = afterMask.reduce((sum, value, i) => sum + Number(value === 1 && beforeMask[i] === 0), 0);
        const lostPixels = beforeMask.reduce((sum, value, i) => sum + Number(value === 1 && afterMask[i] === 0), 0);

        let completionMismatches = 0;
        for (const heading of [Math.PI * 11 / 12, Math.PI / 2, 0, -Math.PI * 5 / 6]) {
          for (const expansion of [0, 180]) {
            const source = { x: 5000, y: 5000, width: 800, spread: 0.9, contact: 1, angle: 0 };
            const fold = beginTrueBrushFold(source, Math.PI * 5 / 6);
            retargetTrueBrushFold(fold, heading);
            const sample = { ...geometry.samples.at(-1)!, ...source, fold };
            const paint = (progress: number) => {
              const canvas = makeCanvas(), ctx = canvas.getContext("2d")!;
              ctx.scale(0.12, 0.12);
              fold.travel = fold.distance * progress;
              ctx.beginPath(); traceBrushFootprintPath(ctx, sample, expansion); ctx.fill();
              return mask(canvas);
            };
            const approaching = paint(1 - 1e-8), complete = paint(1);
            completionMismatches += complete.reduce((sum, value, i) => sum + Number(value !== approaching[i]), 0);
          }
        }

        const gestures = [];
        for (const name of ["right-angle-jitter", "bridged-reversal", "curved-fold", "finger-na"] as const) {
          const gesture: HandwritingStroke = {
            brush: { ...stroke.brush!, size: 100, sensitivity: name === "finger-na" ? 50 : 10 },
            points: Array.from({ length: 31 }, (_, i) => name === "right-angle-jitter" ? [3000, 1500 + i * 100, i * 8] : [1500 + i * 120, 3500, i * 8])
          };
          const turn = (angle: number, count: number) => {
            const [x, y, time] = gesture.points.at(-1)!;
            for (let i = 1; i <= count; i++) gesture.points.push([Math.round(x + i * 80 * Math.cos(angle)), Math.round(y + i * 80 * Math.sin(angle)), time + i * 16]);
          };
          let pressWidth = 0;
          if (name === "finger-na") {
            const [x, y, time] = gesture.points.at(-1)!;
            gesture.points.push([x, y, time + 400]);
            for (let i = 1; i <= 8; i++) gesture.points.push([Math.round(x + i * 80 / Math.SQRT2), Math.round(y + i * 80 / Math.SQRT2), time + 400 + i * 80]);
            pressWidth = handwritingBrushGeometry(gesture).samples.at(-1)!.width;
            const [exitX, exitY, exitTime] = gesture.points.at(-1)!;
            for (let i = 1; i <= 20; i++) gesture.points.push([Math.round(exitX + i * 160 / Math.SQRT2), Math.round(exitY + i * 160 / Math.SQRT2), exitTime + i * 8]);
          } else if (name === "right-angle-jitter") {
            gesture.points.push([3000, 4420, 256]);
            turn(0, 20);
          } else if (name === "bridged-reversal") {
            turn(Math.PI / 3, 1);
            turn(Math.PI * 2 / 3, 1);
            turn(Math.PI * 5 / 6, 24);
          } else {
            turn(Math.PI * 5 / 6, 2);
            turn(Math.PI * 11 / 12, 24);
          }
          const samples = handwritingBrushGeometry(gesture).samples;
          const folds = samples.filter((sample) => sample.fold);
          const release = samples.findIndex((sample, i) => i > 0 && samples[i - 1].fold && !sample.fold);
          const releaseStep = release >= 0 && samples[release + 1] ? Math.hypot(samples[release + 1].x - samples[release].x, samples[release + 1].y - samples[release].y) : 0;
          const incremental = makeCanvas();
          const active: HandwritingStroke = { ...gesture, points: [] };
          for (const point of gesture.points) {
            const start = active.points.length;
            active.points.push(point);
            appendHandwritingStroke(incremental, active, start);
          }
          const staticInk = makeCanvas();
          drawHandwritingCharacter(staticInk, { strokes: [gesture] });
          const incrementalMask = mask(incremental), staticMask = mask(staticInk);
          const pixels = staticMask.reduce((sum, value) => sum + value, 0);
          const difference = staticMask.reduce((sum, value, i) => sum + Number(value !== incrementalMask[i]), 0);
          gestures.push({ name, folded: folds.length > 0, lastFoldHeading: folds.at(-1)?.fold?.heading ?? 0, releaseStep, pixels, mismatchRatio: difference / pixels, pressWidth, finalWidth: samples.at(-1)!.width });
        }

        // Draw a preview directly from the same footprint/fold functions used
        // by live ink, rather than an independent illustration of the rules.
        document.body.innerHTML = "";
        document.body.style.cssText = "margin:0;background:#f5f7f8";
        const preview = document.createElement("canvas");
        preview.width = 1560; preview.height = 750;
        preview.id = "true-brush-preview";
        document.body.append(preview);
        const ctx = preview.getContext("2d")!;
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, preview.width, preview.height);
        ctx.font = "bold 32px sans-serif"; ctx.fillStyle = "#17352b";
        ctx.fillText("真迹壹 · 连续翻折，展开锋向随行笔", 35, 50);
        ctx.font = "18px sans-serif"; ctx.fillStyle = "#687b73";
        ctx.fillText("由实际算法生成：尾锋更细长，无侧向扭动；翻折随运笔距离推进，扫过边际留下墨迹", 35, 83);
        const arrow = (x: number, y: number, angle: number, length: number, color: string) => {
          ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2;
          const ex = x + Math.cos(angle) * length, ey = y + Math.sin(angle) * length;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(ex, ey);
          ctx.lineTo(ex - 12 * Math.cos(angle - 0.4), ey - 12 * Math.sin(angle - 0.4));
          ctx.lineTo(ex - 12 * Math.cos(angle + 0.4), ey - 12 * Math.sin(angle + 0.4)); ctx.fill();
        };
        for (let i = 0; i < 5; i++) {
          const pin = { x: 68 + i * 310, y: 345 };
          const old = -Math.PI / 3, heading = Math.PI * 85 / 180;
          const source = { x: pin.x + Math.cos(old) * 157.5, y: pin.y + Math.sin(old) * 157.5, width: 150, angle: old, spread: 1, contact: 1 };
          const fold = beginTrueBrushFold(source, heading);
          const sample = { ...source, directional: true, algorithm: "true-v1" as const, version: 2 as const, phase: "writing" as const, trailX: 0, trailY: 0, rawX: source.x, rawY: source.y, inputX: source.x, inputY: source.y, handleX: source.x, handleY: source.y, speed: 0 };
          ctx.font = "bold 23px sans-serif"; ctx.fillStyle = "#17352b";
          ctx.fillText(["① 转向前", "② 开始翻折", "③ 继续翻面", "④ 完全展开", "⑤ 释放后跟随"][i], i * 310 + 25, 133);
          arrow(pin.x - Math.cos(old) * 55, pin.y - Math.sin(old) * 55, old, 235, "#df4b45");
          arrow(pin.x, pin.y, heading, 160, "#54a237");
          ctx.beginPath(); traceBrushFootprintPath(ctx, sample);
          ctx.strokeStyle = "#c7cdd2"; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]); ctx.stroke(); ctx.setLineDash([]);
          fold.travel = fold.distance * [0, 0.25, 0.65, 1, 1][i];
          ctx.beginPath();
          if (i === 0) traceBrushFootprintPath(ctx, sample);
          else if (i < 4) traceBrushFootprintPath(ctx, { ...sample, fold });
          else {
            const centre = reflectFoldPoint(fold, source);
            const angle = heading;
            traceBrushFootprintPath(ctx, { ...sample, x: centre.x + Math.cos(heading) * 48, y: centre.y + Math.sin(heading) * 48, angle });
          }
          ctx.fillStyle = "rgba(38,140,255,.22)"; ctx.strokeStyle = "#268cff"; ctx.lineWidth = 2.5; ctx.fill(); ctx.stroke();
          if (i === 1 || i === 2) {
            const crease = trueBrushCrease(fold);
            const normal = trueBrushFoldNormal(fold);
            const cx = pin.x + Math.cos(normal) * crease, cy = pin.y + Math.sin(normal) * crease;
            ctx.beginPath(); ctx.moveTo(cx + Math.sin(normal) * 125, cy - Math.cos(normal) * 125);
            ctx.lineTo(cx - Math.sin(normal) * 125, cy + Math.cos(normal) * 125);
            ctx.strokeStyle = "#644ca6"; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]);
            ctx.font = "16px sans-serif"; ctx.fillStyle = "#644ca6"; ctx.fillText("折线对齐入锋与出锋", i * 310 + 55, 520);
          }
          ctx.beginPath(); ctx.arc(pin.x, pin.y, 5, 0, Math.PI * 2); ctx.fillStyle = i < 4 ? "#e79224" : "#c7cdd2"; ctx.fill();
          ctx.font = "17px sans-serif"; ctx.fillStyle = "#687b73"; ctx.fillText(i === 4 ? "原 P 已释放" : "P 纸面坐标固定", i * 310 + 25, 565);
        }
        ctx.fillStyle = "#f2f5f3"; ctx.fillRect(25, 600, 1510, 122);
        ctx.fillStyle = "#17352b"; ctx.font = "22px sans-serif";
        ctx.fillText("停顿阈值：200 ms      翻折前倍率：0.1      翻折后恢复正常跟随；慢行按住，顺势加速收细出锋", 45, 643);
        ctx.font = "18px sans-serif"; ctx.fillStyle = "#687b73";
        ctx.fillText("上排显示当前接触轮廓；实际笔迹保留所有扫过区域。图中急转方向差为 145°。", 45, 684);
        return { mismatches, inkPixels, newPixels, lostPixels, gestures, completionMismatches };
      });
      expect(result.inkPixels).toBeGreaterThan(1000);
      expect(result.mismatches / result.inkPixels).toBeLessThan(0.025);
      expect(result.newPixels).toBeGreaterThan(100);
      expect(result.lostPixels).toBe(0);
      expect(result.completionMismatches).toBe(0);
      for (const gesture of result.gestures) {
        expect(gesture.folded, gesture.name).toBe(gesture.name === "bridged-reversal" || gesture.name === "curved-fold");
        if (gesture.name === "finger-na") expect(gesture.finalWidth).toBeLessThan(gesture.pressWidth * 0.2);
        if (gesture.name === "curved-fold") expect(Math.abs(gesture.lastFoldHeading - Math.PI * 11 / 12)).toBeLessThan(0.08);
        expect(gesture.releaseStep, gesture.name).toBeLessThanOrEqual(65);
        expect(gesture.pixels, gesture.name).toBeGreaterThan(1000);
        expect(gesture.mismatchRatio, gesture.name).toBeLessThan(0.025);
      }
      await target.setViewportSize({ width: 1560, height: 750 });
      await target.locator("#true-brush-preview").screenshot({ path: `output/playwright/true-brush-fold-${name}.png` });
    }
  } finally {
    await safari.close();
  }
});
