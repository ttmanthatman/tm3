import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import {
  DIAGNOSTIC_URLS,
  currentCheckoutSha,
  lockedPlaywrightVersion,
  materializeAlphaDiagnosticCopies
} from "../helpers/alphaDiagnostics";

// 受控 alpha 取证实验（回件 to-glm-2026-10-26-alpha-path-review §4）。本文件只做
// 能区分变量的实验与观察记录，不新增产品修复；alpha<=2 的验收门禁仍在
// playback-ui.spec.ts 的原用例上，本文件的像素数据一律作为证据记录而非新容差。
//
// 四模式矩阵固定输入（画布尺寸/transform/颜色/路径命令与管线 raster 完全一致）：
//   A = parent renderer(7839e5c^, canvas 当前路径) + 同任务 drain
//   B = parent renderer + 每个原 yield 间隔一次真实 rAF
//   C = baseline renderer(7839e5c, 独立 Path2D) + 同任务 drain
//   D = baseline renderer + 每个原 yield 间隔一次真实 rAF
// A/B、C/D 只改推进方式；A/C、B/D 只改路径承载方式。孤立模式的同步 drain 仅为
// 诊断对照，不是产品方案。完成判定用生成器 done，读回固定为完成后恰一次快照。

type RendererModule = typeof import("../../src/client/features/handwriting/handwritingRenderer");
type PipelineModule = typeof import("../../src/client/features/bible/copywork/copyworkPlaybackRenderer");
type LayoutModule = typeof import("../../src/client/features/bible/copywork/copyworkPageLayout");
type SharedModule = typeof import("../../src/shared/bibleCopywork");

const MODE_RUNS = 30;
const MODES = ["A", "B", "C", "D"] as const;
const EVIDENCE_PNG_CAP = 8; // 每个比较类型×DPR 最多保存的图像对数
const EVIDENCE_ALPHA_CAP = 3; // 每个比较类型×DPR 最多内嵌的完整 alpha 对数

// 与 playback-ui.spec.ts 取证用例完全一致的 1280/n=300 输入；孤立模式直接复刻
// 管线 raster 的 transform 链（setTransform 单位阵 → scale → translate×2 → font 缩放）。
const EXPERIMENT_INPUT = {
  cssCanvasWidth: 1239.75,
  points: 300,
  placement: { index: 0, x: 77.35, y: 100.65 },
  view: { x: 13.7, y: 29.2, width: 704, height: 320 }
};

async function diagnosticsPage(page: Page) {
  await page.route("**/alpha-diagnostics-harness", (route) => route.fulfill({
    contentType: "text/html",
    body: '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"></body></html>'
  }));
  await page.goto("/alpha-diagnostics-harness");
  await page.setViewportSize({ width: 1280, height: 844 });
}

async function environmentInfo(page: Page) {
  const declaredPlaywright = JSON.parse(await fs.readFile("package.json", "utf8")).devDependencies["@playwright/test"];
  const [lockedPlaywright, checkout] = await Promise.all([lockedPlaywrightVersion(), currentCheckoutSha()]);
  const gpu = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return { webgl: "unavailable" };
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    return { webgl: String(debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) };
  });
  return {
    engine: "chromium",
    browserVersion: page.context().browser()?.version() ?? "unknown",
    playwrightDeclared: declaredPlaywright,
    playwrightLocked: lockedPlaywright,
    os: process.platform,
    arch: process.arch,
    userAgent: await page.evaluate(() => navigator.userAgent),
    webglRenderer: gpu.webgl,
    // 2D canvas 后端没有可查询接口；按回件要求记 unknown，不做平台推断。
    canvasBackend: "unknown",
    checkout
  };
}

test("four-mode alpha experiment separates scheduling from path target (chromium)", async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  const copies = await materializeAlphaDiagnosticCopies();
  test.skip(!copies.ok, `diagnostic copies unavailable (shallow checkout? git show failed): ${copies.error}`);
  await diagnosticsPage(page);
  const environment = await environmentInfo(page);
  const result = await page.evaluate(async ({ urls, input, runs, caps }) => {
    const parentMod = await import(urls.rendererParent) as RendererModule;
    const baselineMod = await import(urls.rendererBaseline) as RendererModule;
    const currentMod = await import("/src/client/features/handwriting/handwritingRenderer.ts") as RendererModule;
    const layout = await import("/src/client/features/bible/copywork/copyworkPageLayout.ts") as LayoutModule;
    const shared = await import("/src/shared/bibleCopywork.ts") as SharedModule;
    const { COPYWORK_PAGE } = shared;
    const glyph = { index: 0, bounds: { left: 0, top: 0, right: 10000, bottom: 10000 }, character: { strokes: [{
      color: "#268cff", brush: { size: 45, sensitivity: 65, lag: 35 },
      points: Array.from({ length: input.points }, (_, i) => [1000 + i * 25, 5000 + Math.sin(i / 15) * 3000, i * 8] as [number, number, number])
    }] } };
    const placement = input.placement;
    const view = input.view;
    const modes = ["A", "B", "C", "D"] as const;
    type Mode = typeof modes[number];
    const realRaf = window.requestAnimationFrame.bind(window);

    const alphaOf = (data: Uint8ClampedArray) => { const out = new Uint8Array(data.length / 4); for (let i = 3, j = 0; i < data.length; i += 4, j += 1) out[j] = data[i]; return out; };
    const snapshotAlpha = (canvas: HTMLCanvasElement) => alphaOf(canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data);
    const metrics = (a: Uint8Array, b: Uint8Array, w: number, h: number) => {
      let maxDiff = 0, countOver = 0;
      const worst: Array<{ diff: number; x: number; y: number; a: number; b: number }> = [];
      for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
        const index = y * w + x;
        const diff = Math.abs(a[index] - b[index]);
        if (diff > maxDiff) maxDiff = diff;
        if (diff > 2) countOver += 1;
        if (diff > 0) worst.push({ diff, x, y, a: a[index], b: b[index] });
      }
      worst.sort((p, q) => q.diff - p.diff);
      return { maxDiff, countOver2: countOver, topPixels: worst.slice(0, 12) };
    };
    type Metrics = ReturnType<typeof metrics>;
    const fnv = (bytes: Uint8Array) => { let hash = 0x811c9dc5; for (let i = 0; i < bytes.length; i += 1) { hash ^= bytes[i]; hash = Math.imul(hash, 0x01000193) >>> 0; } return hash.toString(16); };

    const applyTransform = (ctx: CanvasRenderingContext2D, width: number) => {
      const scale = width / view.width;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(scale, scale);
      ctx.translate(-view.x, -view.y);
      ctx.translate(placement.x, placement.y);
      ctx.scale(COPYWORK_PAGE.font / 10000, COPYWORK_PAGE.font / 10000);
    };

    let fillCount = 0;
    const originalFill = CanvasRenderingContext2D.prototype.fill;
    CanvasRenderingContext2D.prototype.fill = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof originalFill>) {
      fillCount += 1;
      return originalFill.apply(this, args);
    };

    const freshCanvas = (width: number, height: number) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    };
    const directOn = (width: number, height: number) => {
      const canvas = freshCanvas(width, height);
      const ctx = canvas.getContext("2d")!;
      applyTransform(ctx, width);
      currentMod.drawHandwritingInk(ctx, glyph.character, [input.points]);
      return canvas;
    };

    // 命令指纹：分别在 context 原型与 Path2D 原型上计数+滚动哈希路径命令，
    // parent 与 baseline 的命令流必须完全一致（同一套几何数学）。
    const fingerprintOf = (mod: RendererModule, target: "context" | "path2d") => {
      const proto = (target === "context" ? CanvasRenderingContext2D.prototype : Path2D.prototype) as unknown as Record<string, (...args: unknown[]) => void>;
      const names = ["moveTo", "lineTo", "bezierCurveTo", "ellipse", "arc", "closePath"];
      const counts: Record<string, number> = {};
      let hash = 0x811c9dc5;
      const originals: Record<string, (...args: unknown[]) => void> = {};
      for (const name of names) {
        counts[name] = 0;
        originals[name] = proto[name];
        proto[name] = function (...args: unknown[]) {
          counts[name] += 1;
          const serialized = `${name}:${args.map((value) => Math.round(Number(value) * 1e4)).join(",")}`;
          for (let i = 0; i < serialized.length; i += 1) { hash ^= serialized.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
          return originals[name].apply(this, args);
        };
      }
      try {
        const canvas = freshCanvas(400, 200);
        const ctx = canvas.getContext("2d")!;
        applyTransform(ctx, 400);
        fillCount = 0;
        const gen = mod.drawHandwritingInkSteps(ctx, glyph.character, [input.points]);
        while (!gen.next().done) { /* drain: 指纹通道只看命令流 */ }
        canvas.width = 0;
        return { counts, hash: hash.toString(16), fills: fillCount };
      } finally {
        for (const name of names) proto[name] = originals[name];
      }
    };

    type RunResult = {
      mode: Mode; fills: number; fillTaskIndex: number; frameTimes: number[]; taskMs: number[];
      wallMs: number; alphaHash: string; canvas: HTMLCanvasElement; alpha: Uint8Array;
    };
    const runMode = async (mode: Mode, width: number, height: number): Promise<RunResult> => {
      const canvas = freshCanvas(width, height);
      const ctx = canvas.getContext("2d")!;
      applyTransform(ctx, width);
      const mod: RendererModule = mode === "A" || mode === "B" ? parentMod : baselineMod;
      const gen = mod.drawHandwritingInkSteps(ctx, glyph.character, [input.points]);
      fillCount = 0;
      const frameTimes: number[] = [];
      const taskMs: number[] = [];
      const started = performance.now();
      const deadline = started + 20_000;
      let fillTaskIndex = -1;
      const track = (): boolean => {
        const before = fillCount;
        const t0 = performance.now();
        const step = gen.next();
        taskMs.push(performance.now() - t0);
        if (fillCount > before && fillTaskIndex < 0) fillTaskIndex = taskMs.length - 1;
        return step.done === true;
      };
      if (mode === "A" || mode === "C") {
        while (!track()) { /* 同任务 drain（诊断专用，非产品方案） */ }
      } else {
        await new Promise<void>((resolve, reject) => {
          const advance = (time: number) => {
            frameTimes.push(time);
            let done = false;
            try { done = track(); } catch (error) { reject(error); return; }
            if (done) { resolve(); return; }
            if (performance.now() > deadline) { reject(new Error(`mode ${mode} exceeded 20s deadline`)); return; }
            realRaf(advance);
          };
          realRaf(advance);
        });
      }
      const alpha = snapshotAlpha(canvas);
      return { mode, fills: fillCount, fillTaskIndex, frameTimes, taskMs, wallMs: performance.now() - started, alphaHash: fnv(alpha), canvas, alpha };
    };

    type EvidenceParty = { id: string; alpha: Uint8Array; png: string };
    // 完整 alpha 用 base64 打包（逐字节、行优先、width×height）；JSON 数字数组
    // 会让证据在 DPR2 下膨胀到几十 MB。
    const b64Alpha = (alpha: Uint8Array) => {
      let binary = "";
      for (let i = 0; i < alpha.length; i += 0x8000) binary += String.fromCharCode(...alpha.subarray(i, i + 0x8000));
      return btoa(binary);
    };
    const evidence: Array<Record<string, unknown>> = [];
    const savedCounters: Record<string, number> = {};
    const recordEvidence = (comparison: string, dpr: number, round: number, a: EvidenceParty, b: EvidenceParty, metric: Metrics) => {
      const key = `${comparison}:dpr${dpr}`;
      savedCounters[key] = (savedCounters[key] ?? 0) + 1;
      const index = savedCounters[key];
      if (index > caps.png + caps.alpha) return;
      evidence.push({
        comparison, dpr, round, ids: [a.id, b.id], maxDiff: metric.maxDiff, countOver2: metric.countOver2,
        topPixels: metric.topPixels,
        png: index <= caps.png ? { a: a.png, b: b.png } : "png cap reached",
        alphaDump: index <= caps.png + caps.alpha
          ? { encoding: "base64-raw-alpha-bytes-row-major", a: b64Alpha(a.alpha), b: b64Alpha(b.alpha) }
          : "alpha cap reached"
      });
    };

    type RoundReport = {
      round: number; order: Mode[];
      perMode: Record<Mode, { vsDirect: Metrics; alphaHash: string; fills: number; fillTaskIndex: number; tasks: number; frames: number; wallMs: number }>;
      pairs: Record<string, { maxDiff: number; countOver2: number }>;
    };
    type DprReport = {
      dpr: number; canvas: { width: number; height: number }; directRepeat: Metrics;
      totals: Record<string, { exceed: number; denominator: number; maxDiff: number }>;
      rounds: RoundReport[]; frameStats: Record<string, { min: number; max: number }>;
    };
    try {
      const fingerprint = {
        parentContext: fingerprintOf(parentMod, "context"),
        baselinePath2d: fingerprintOf(baselineMod, "path2d")
      };
      const perDpr: DprReport[] = [];
      for (const ratio of [1, 2]) {
        const size = layout.copyworkCanvasSize(input.cssCanvasWidth, view.width / view.height, ratio);
        const direct1 = directOn(size.width, size.height);
        const direct2 = directOn(size.width, size.height);
        const directAlpha = snapshotAlpha(direct1);
        const directPng = direct1.toDataURL("image/png");
        const directRepeat = metrics(directAlpha, snapshotAlpha(direct2), size.width, size.height);
        direct1.width = 0;
        direct2.width = 0;
        const directRef: EvidenceParty = { id: `direct-dpr${ratio}`, alpha: directAlpha, png: directPng };
        const anchors = new Map<Mode, EvidenceParty>();
        const rounds: RoundReport[] = [];
        const totals: Record<string, { exceed: number; denominator: number; maxDiff: number }> = {};
        const bump = (comparison: string, metric: Metrics) => {
          const entry = totals[comparison] ?? (totals[comparison] = { exceed: 0, denominator: 0, maxDiff: 0 });
          entry.denominator += 1;
          entry.maxDiff = Math.max(entry.maxDiff, metric.maxDiff);
          if (metric.maxDiff > 2) entry.exceed += 1;
        };
        for (let round = 0; round < runs; round += 1) {
          const order = modes.map((_, i) => modes[(i + round) % modes.length]);
          const runsByMode = new Map<Mode, RunResult>();
          for (const mode of order) runsByMode.set(mode, await runMode(mode, size.width, size.height));
          const report: RoundReport = { round, order, perMode: {} as RoundReport["perMode"], pairs: {} };
          for (const mode of modes) {
            const run = runsByMode.get(mode)!;
            const id = `${mode}-dpr${ratio}-r${round}`;
            const vsDirect = metrics(directAlpha, run.alpha, size.width, size.height);
            bump(`${mode}-vs-direct`, vsDirect);
            if (round === 0) {
              anchors.set(mode, { id: `${mode}-dpr${ratio}-anchor`, alpha: run.alpha, png: run.canvas.toDataURL("image/png") });
            } else {
              const anchor = anchors.get(mode)!;
              const vsAnchor = metrics(anchor.alpha, run.alpha, size.width, size.height);
              bump(`${mode}-self`, vsAnchor);
              if (vsAnchor.maxDiff > 2) {
                recordEvidence(`${mode}-self`, ratio, round, anchor, { id, alpha: run.alpha, png: run.canvas.toDataURL("image/png") }, vsAnchor);
              }
            }
            if (vsDirect.maxDiff > 2) {
              recordEvidence(`${mode}-vs-direct`, ratio, round, directRef, { id, alpha: run.alpha, png: run.canvas.toDataURL("image/png") }, vsDirect);
            }
            report.perMode[mode] = { vsDirect, alphaHash: run.alphaHash, fills: run.fills, fillTaskIndex: run.fillTaskIndex,
              tasks: run.taskMs.length, frames: run.frameTimes.length, wallMs: Math.round(run.wallMs * 100) / 100 };
          }
          const pairDefs: Array<[Mode, Mode]> = [["A", "B"], ["C", "D"], ["A", "C"], ["B", "D"]];
          for (const [left, right] of pairDefs) {
            const a = runsByMode.get(left)!;
            const b = runsByMode.get(right)!;
            const metric = metrics(a.alpha, b.alpha, size.width, size.height);
            bump(`${left}-${right}`, metric);
            report.pairs[`${left}-${right}`] = { maxDiff: metric.maxDiff, countOver2: metric.countOver2 };
            if (metric.maxDiff > 2) {
              recordEvidence(`${left}-${right}`, ratio, round,
                { id: `${left}-dpr${ratio}-r${round}`, alpha: a.alpha, png: a.canvas.toDataURL("image/png") },
                { id: `${right}-dpr${ratio}-r${round}`, alpha: b.alpha, png: b.canvas.toDataURL("image/png") }, metric);
            }
          }
          rounds.push(report);
          for (const run of runsByMode.values()) run.canvas.width = 0;
        }
        perDpr.push({
          dpr: ratio, canvas: size, directRepeat, totals, rounds,
          frameStats: Object.fromEntries(modes.map((mode) => {
            const values = rounds.map((entry) => entry.perMode[mode].frames);
            return [mode, { min: Math.min(...values), max: Math.max(...values) }];
          }))
        });
      }
      return { fingerprint, perDpr, evidence, savedCounters };
    } finally {
      CanvasRenderingContext2D.prototype.fill = originalFill;
    }
  }, { urls: DIAGNOSTIC_URLS, input: EXPERIMENT_INPUT, runs: MODE_RUNS, caps: { png: EVIDENCE_PNG_CAP, alpha: EVIDENCE_ALPHA_CAP } });

  const payload = { environment: { ...environment, diagnosticCopies: copies.provenance }, ...result };
  await fs.writeFile(testInfo.outputPath("alpha-controlled-four-mode.json"), JSON.stringify(payload), "utf8");
  await fs.writeFile(testInfo.outputPath("alpha-controlled-four-mode-evidence.json"), JSON.stringify(result.evidence), "utf8");
  // attach 件剥掉大体积 alphaDump/PNG，原始数据在 outputPath 两个 JSON 里。
  await testInfo.attach("alpha-controlled-four-mode.json", {
    body: JSON.stringify({
      ...payload,
      evidence: result.evidence.map((entry) => ({ ...entry, png: "see evidence json", alphaDump: "see evidence json" }))
    }),
    contentType: "application/json"
  });

  // 溯源与 harness 结构断言；像素差异只进证据不做新门禁（原门禁在 playback-ui.spec.ts）。
  expect(copies.provenance).not.toBeNull();
  expect(result.fingerprint.parentContext.hash).toBe(result.fingerprint.baselinePath2d.hash);
  expect(result.fingerprint.parentContext.counts).toEqual(result.fingerprint.baselinePath2d.counts);
  expect(result.fingerprint.parentContext.fills).toBe(1);
  expect(result.fingerprint.baselinePath2d.fills).toBe(1);
  for (const dpr of result.perDpr) {
    expect(dpr.rounds).toHaveLength(MODE_RUNS);
    for (const round of dpr.rounds) {
      for (const mode of MODES) {
        expect(round.perMode[mode].fills, `dpr${dpr.dpr} round${round.round} mode ${mode}`).toBe(1);
        expect(round.perMode[mode].tasks).toBeGreaterThan(0);
      }
    }
  }
  const lines: string[] = [];
  for (const dpr of result.perDpr) {
    lines.push(`dpr${dpr.dpr} canvas ${dpr.canvas.width}x${dpr.canvas.height} directRepeat maxDiff ${dpr.directRepeat.maxDiff}`);
    for (const [comparison, total] of Object.entries(dpr.totals)) lines.push(`  ${comparison}: exceed ${total.exceed}/${total.denominator} maxDiff ${total.maxDiff}`);
    lines.push(`  frames: ${JSON.stringify(dpr.frameStats)}`);
  }
  console.log(`[alpha-controlled] four-mode summary\n${lines.join("\n")}`);
});

test("brush stroke fills exactly once when advanced across real rAF frames (chromium)", async ({ page }, testInfo) => {
  await diagnosticsPage(page);
  const result = await page.evaluate(async ({ input }) => {
    const currentMod = await import("/src/client/features/handwriting/handwritingRenderer.ts") as RendererModule;
    const layout = await import("/src/client/features/bible/copywork/copyworkPageLayout.ts") as LayoutModule;
    const shared = await import("/src/shared/bibleCopywork.ts") as SharedModule;
    const { COPYWORK_PAGE } = shared;
    const glyph = { index: 0, bounds: { left: 0, top: 0, right: 10000, bottom: 10000 }, character: { strokes: [{
      color: "#268cff", brush: { size: 45, sensitivity: 65, lag: 35 },
      points: Array.from({ length: input.points }, (_, i) => [1000 + i * 25, 5000 + Math.sin(i / 15) * 3000, i * 8] as [number, number, number])
    }] } };
    const placement = input.placement;
    const view = input.view;
    const realRaf = window.requestAnimationFrame.bind(window);
    const size = layout.copyworkCanvasSize(input.cssCanvasWidth, view.width / view.height, 1);
    const alphaOf = (data: Uint8ClampedArray) => { const out = new Uint8Array(data.length / 4); for (let i = 3, j = 0; i < data.length; i += 4, j += 1) out[j] = data[i]; return out; };

    let fillCount = 0;
    const originalFill = CanvasRenderingContext2D.prototype.fill;
    CanvasRenderingContext2D.prototype.fill = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof originalFill>) {
      fillCount += 1;
      return originalFill.apply(this, args);
    };
    let pathCommandCount = 0;
    const proto = CanvasRenderingContext2D.prototype as unknown as Record<string, (...args: unknown[]) => void>;
    const pathProto = Path2D.prototype as unknown as Record<string, (...args: unknown[]) => void>;
    const names = ["moveTo", "lineTo", "bezierCurveTo", "ellipse", "arc", "closePath"];
    const originals: Record<string, (...args: unknown[]) => void> = {};
    const pathOriginals: Record<string, (...args: unknown[]) => void> = {};
    // 当前模块把几何发给独立 Path2D，context 当前路径不会被使用；两个原型都
    // 计数，帧级命令分布才对两种承载方式都有效。
    for (const name of names) {
      originals[name] = proto[name];
      proto[name] = function (...args: unknown[]) { pathCommandCount += 1; return originals[name].apply(this, args); };
      pathOriginals[name] = pathProto[name];
      pathProto[name] = function (...args: unknown[]) { pathCommandCount += 1; return pathOriginals[name].apply(this, args); };
    }
    const applyTransform = (ctx: CanvasRenderingContext2D, width: number) => {
      const scale = width / view.width;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(scale, scale);
      ctx.translate(-view.x, -view.y);
      ctx.translate(placement.x, placement.y);
      ctx.scale(COPYWORK_PAGE.font / 10000, COPYWORK_PAGE.font / 10000);
    };
    try {
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext("2d")!;
      applyTransform(ctx, size.width);
      const gen = currentMod.drawHandwritingInkSteps(ctx, glyph.character, [input.points]);
      const frameTimes: number[] = [];
      const fillsPerFrame: number[] = [];
      const pathCommandsPerFrame: number[] = [];
      await new Promise<void>((resolve, reject) => {
        const advance = (time: number) => {
          frameTimes.push(time);
          const beforeFills = fillCount;
          const beforeCommands = pathCommandCount;
          let done = false;
          try { done = gen.next().done === true; } catch (error) { reject(error); return; }
          fillsPerFrame.push(fillCount - beforeFills);
          pathCommandsPerFrame.push(pathCommandCount - beforeCommands);
          if (done) { resolve(); return; }
          realRaf(advance);
        };
        realRaf(advance);
      });
      const totalFills = fillCount;
      const alpha = alphaOf(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
      const png = canvas.toDataURL("image/png");
      const direct = document.createElement("canvas");
      direct.width = size.width;
      direct.height = size.height;
      const directCtx = direct.getContext("2d")!;
      applyTransform(directCtx, size.width);
      currentMod.drawHandwritingInk(directCtx, glyph.character, [input.points]);
      const directAlpha = alphaOf(directCtx.getImageData(0, 0, direct.width, direct.height).data);
      let maxDiffVsDirect = 0, countOver2 = 0;
      const topPixels: Array<{ diff: number; x: number; y: number; a: number; b: number }> = [];
      for (let i = 0; i < alpha.length; i += 1) {
        const diff = Math.abs(alpha[i] - directAlpha[i]);
        if (diff > maxDiffVsDirect) maxDiffVsDirect = diff;
        if (diff > 2) countOver2 += 1;
        if (diff > 0) topPixels.push({ diff, x: i % size.width, y: Math.floor(i / size.width), a: alpha[i], b: directAlpha[i] });
      }
      topPixels.sort((a, b) => b.diff - a.diff);
      return {
        frameTimes, fillsPerFrame, pathCommandsPerFrame, totalFills, maxDiffVsDirect, countOver2,
        topPixels: topPixels.slice(0, 12), finalInk: [...alpha].some((v) => v > 0),
        canvasSize: { width: size.width, height: size.height }, png
      };
    } finally {
      CanvasRenderingContext2D.prototype.fill = originalFill;
      for (const name of names) {
        proto[name] = originals[name];
        pathProto[name] = pathOriginals[name];
      }
    }
  }, { input: EXPERIMENT_INPUT });

  await fs.writeFile(testInfo.outputPath("alpha-controlled-real-raf-behavior.json"), JSON.stringify({ ...result, png: undefined }), "utf8");
  await testInfo.attach("alpha-controlled-real-raf-behavior.json", { body: JSON.stringify({ ...result, png: undefined }), contentType: "application/json" });
  await fs.writeFile(testInfo.outputPath("alpha-controlled-real-raf-behavior-canvas.png"), Buffer.from(result.png.split(",")[1], "base64"));
  console.log(`[alpha-controlled] real-rAF behavior: frames=${result.frameTimes.length} fills=${result.totalFills} maxDiffVsDirect=${result.maxDiffVsDirect} countOver2=${result.countOver2} commandsPerFrame=${result.pathCommandsPerFrame.join("/")}`);

  // 真实帧推进下：恰一次 fill（无部分填充）、完成后出墨、与 direct 的 alpha 差
  // 维持原门禁口径（<=2）。帧数与命令数只作记录。
  expect(result.frameTimes.length).toBeGreaterThanOrEqual(2);
  expect(result.totalFills).toBe(1);
  expect(result.fillsPerFrame.reduce((sum, value) => sum + value, 0)).toBe(1);
  expect(result.finalInk).toBe(true);
  expect(result.maxDiffVsDirect, `real-rAF construction vs direct, ${result.countOver2} pixels over 2`).toBeLessThanOrEqual(2);
});

test("real-clock budget probe separates per-task cpu cost from frame timing (chromium)", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const copies = await materializeAlphaDiagnosticCopies();
  test.skip(!copies.ok, `diagnostic copies unavailable (shallow checkout? git show failed): ${copies.error}`);
  await diagnosticsPage(page);
  const environment = await environmentInfo(page);
  const result = await page.evaluate(async ({ urls, input }) => {
    const parentMod = await import(urls.rendererParent) as RendererModule;
    const baselineMod = await import(urls.rendererBaseline) as RendererModule;
    const parentPipeline = await import(urls.pipelineParentWired) as PipelineModule;
    const currentPipeline = await import("/src/client/features/bible/copywork/copyworkPlaybackRenderer.ts") as PipelineModule;
    const layout = await import("/src/client/features/bible/copywork/copyworkPageLayout.ts") as LayoutModule;
    const shared = await import("/src/shared/bibleCopywork.ts") as SharedModule;
    const { COPYWORK_PAGE } = shared;
    const glyph = { index: 0, bounds: { left: 0, top: 0, right: 10000, bottom: 10000 }, character: { strokes: [{
      color: "#268cff", brush: { size: 45, sensitivity: 65, lag: 35 },
      points: Array.from({ length: input.points }, (_, i) => [1000 + i * 25, 5000 + Math.sin(i / 15) * 3000, i * 8] as [number, number, number])
    }] } };
    const placement = input.placement;
    const view = input.view;
    const realRaf = window.requestAnimationFrame.bind(window);
    const nextFrame = () => new Promise<number>((resolve) => realRaf(resolve));

    let fillCount = 0;
    const originalFill = CanvasRenderingContext2D.prototype.fill;
    CanvasRenderingContext2D.prototype.fill = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof originalFill>) {
      fillCount += 1;
      return originalFill.apply(this, args);
    };
    const applyTransform = (ctx: CanvasRenderingContext2D, width: number) => {
      const scale = width / view.width;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(scale, scale);
      ctx.translate(-view.x, -view.y);
      ctx.translate(placement.x, placement.y);
      ctx.scale(COPYWORK_PAGE.font / 10000, COPYWORK_PAGE.font / 10000);
    };

    // 孤立生成器探针：真实 rAF 推进，真实时钟计量每次 next() 的 CPU 耗时，
    // 标出最终 fill 所在任务。读回与序列化不在测量窗口内。
    const isolatedRun = async (mod: RendererModule, variant: string, group: string, rep: number) => {
      const size = layout.copyworkCanvasSize(input.cssCanvasWidth, view.width / view.height, 1);
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext("2d")!;
      applyTransform(ctx, size.width);
      const gen = mod.drawHandwritingInkSteps(ctx, glyph.character, [input.points]);
      fillCount = 0;
      const taskMs: number[] = [];
      const started = performance.now();
      let fillTaskIndex = -1;
      await new Promise<void>((resolve, reject) => {
        const advance = () => {
          const before = fillCount;
          const t0 = performance.now();
          let done = false;
          try { done = gen.next().done === true; } catch (error) { reject(error); return; }
          taskMs.push(performance.now() - t0);
          if (fillCount > before && fillTaskIndex < 0) fillTaskIndex = taskMs.length - 1;
          if (done) { resolve(); return; }
          realRaf(advance);
        };
        realRaf(advance);
      });
      const record = {
        kind: "isolated" as const, variant, group, rep, dpr: 1, tasks: taskMs.length,
        maxTaskMs: Math.round(Math.max(...taskMs) * 100) / 100,
        totalCpuMs: Math.round(taskMs.reduce((sum, value) => sum + value, 0) * 100) / 100,
        finalFillTaskIndex: fillTaskIndex, fills: fillCount,
        e2eMs: Math.round((performance.now() - started) * 100) / 100,
        taskMs: taskMs.map((value) => Math.round(value * 100) / 100)
      };
      canvas.width = 0;
      return record;
    };

    // 完整管线探针：rAF 包装只计回调墙钟时长（队列 flush 在其中执行）；完成判定
    // 按目标画布身份观察最后一次 drawImage 返回，等待期间不读像素、不加固定
    // sleep；settle 帧走未包装的原始 rAF，不计入回调统计。
    const pipelineRun = async (mod: PipelineModule, variant: string, group: string, rep: number, dpr: number) => {
      const canvas = document.createElement("canvas");
      canvas.style.width = `${input.cssCanvasWidth}px`;
      document.body.append(canvas);
      const targetDraws: number[] = [];
      const originalDrawImage = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, source: CanvasImageSource, ...rest: number[]) {
        const result = originalDrawImage.apply(this, [source, ...rest] as Parameters<typeof originalDrawImage>);
        if (this.canvas === canvas) targetDraws.push(performance.now());
        return result;
      } as typeof originalDrawImage;
      let callbackCount = 0, callbackMaxMs = 0;
      const originalFrame = window.requestAnimationFrame;
      window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
        return originalFrame.call(window, (time) => {
          const started = performance.now();
          try { callback(time); } finally {
            const spent = performance.now() - started;
            callbackCount += 1;
            if (spent > callbackMaxMs) callbackMaxMs = spent;
          }
        });
      }) as typeof requestAnimationFrame;
      try {
        fillCount = 0;
        const renderer = mod.createCopyworkPlaybackRenderer({ canvas: () => canvas,
          viewport: () => ({ ...view }), glyphs: () => [glyph], placements: () => [placement], active: () => true });
        const drawnAt = performance.now();
        renderer.draw(new Map([[0, [input.points]]]));
        const deadline = performance.now() + 5000;
        while (!targetDraws.length) {
          if (performance.now() > deadline) throw new Error(`pipeline ${variant} did not reach the final canvas in 5s`);
          await nextFrame();
        }
        await nextFrame();
        await nextFrame();
        renderer.destroy();
        return {
          kind: "pipeline" as const, variant, group, rep, dpr,
          frameCallbacks: callbackCount, callbackMaxMs: Math.round(callbackMaxMs * 100) / 100,
          fills: fillCount, e2eMs: Math.round((targetDraws[targetDraws.length - 1]! - drawnAt) * 100) / 100,
          targetDrawCount: targetDraws.length
        };
      } finally {
        window.requestAnimationFrame = originalFrame;
        CanvasRenderingContext2D.prototype.drawImage = originalDrawImage;
        canvas.remove();
      }
    };

    try {
      const isolated: unknown[] = [];
      // 冷组 = 模块加载后的前几次执行（跨页共享进程时只是近似冷）；交错执行摊平
      // 后台噪声。热组前有未记录的预热组。
      for (let rep = 0; rep < 3; rep += 1) {
        isolated.push(await isolatedRun(parentMod, "parent", "cold", rep));
        isolated.push(await isolatedRun(baselineMod, "baseline", "cold", rep));
      }
      for (let warmup = 0; warmup < 3; warmup += 1) {
        await isolatedRun(parentMod, "parent", "warmup-unrecorded", warmup);
        await isolatedRun(baselineMod, "baseline", "warmup-unrecorded", warmup);
      }
      for (let rep = 0; rep < 5; rep += 1) {
        isolated.push(await isolatedRun(parentMod, "parent", "hot", rep));
        isolated.push(await isolatedRun(baselineMod, "baseline", "hot", rep));
      }
      const pipeline: unknown[] = [];
      const originalRatio = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
      try {
        for (const dpr of [1, 2]) {
          Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: dpr });
          for (const group of ["cold", "hot"]) {
            const reps = group === "cold" ? 2 : 3;
            if (group === "hot") {
              await pipelineRun(parentPipeline, "parent", "warmup-unrecorded", 0, dpr);
              await pipelineRun(currentPipeline, "current", "warmup-unrecorded", 0, dpr);
            }
            for (let rep = 0; rep < reps; rep += 1) {
              pipeline.push(await pipelineRun(parentPipeline, "parent", group, rep, dpr));
              pipeline.push(await pipelineRun(currentPipeline, "current", group, rep, dpr));
            }
          }
        }
      } finally {
        if (originalRatio) Object.defineProperty(window, "devicePixelRatio", originalRatio);
        else delete (window as { devicePixelRatio?: number }).devicePixelRatio;
      }
      return { isolated, pipeline };
    } finally {
      CanvasRenderingContext2D.prototype.fill = originalFill;
    }
  }, { urls: DIAGNOSTIC_URLS, input: EXPERIMENT_INPUT });

  const payload = { environment: { ...environment, diagnosticCopies: copies.provenance }, ...result };
  await fs.writeFile(testInfo.outputPath("alpha-controlled-budget-probe.json"), JSON.stringify(payload), "utf8");
  await testInfo.attach("alpha-controlled-budget-probe.json", { body: JSON.stringify(payload), contentType: "application/json" });

  for (const run of result.isolated as Array<{ variant: string; group: string; fills: number; tasks: number }>) {
    if (run.group === "warmup-unrecorded") continue;
    expect(run.fills, `isolated ${run.variant}/${run.group}`).toBe(1);
    expect(run.tasks).toBeGreaterThan(0);
  }
  for (const run of result.pipeline as Array<{ variant: string; group: string; dpr: number; fills: number; targetDrawCount: number }>) {
    if (run.group === "warmup-unrecorded") continue;
    expect(run.fills, `pipeline ${run.variant}/${run.group}/dpr${run.dpr}`).toBe(1);
    expect(run.targetDrawCount).toBeGreaterThan(0);
  }
  const summary = [...(result.isolated as Array<Record<string, unknown>>), ...(result.pipeline as Array<Record<string, unknown>>)]
    .filter((run) => run.group !== "warmup-unrecorded")
    .map((run) => `${run.kind}/${run.variant}/${run.group}/dpr${run.dpr}: tasks=${run.tasks ?? "-"} maxTask=${run.maxTaskMs ?? "-"} callbacks=${run.frameCallbacks ?? "-"} cbMax=${run.callbackMaxMs ?? "-"} e2e=${run.e2eMs}`);
  console.log(`[alpha-controlled] budget probe\n${summary.join("\n")}`);
});
