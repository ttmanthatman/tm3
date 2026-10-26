import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

// Alpha 取证实验的物料层（回件 to-glm-2026-10-26-alpha-path-review §4）：
// 从 git 历史生成两个 SHA 的 renderer 诊断副本到忽略目录 output/diagnostics/，
// 只做导入路径适配，其余逐字节等于 `git show` 输出；副本经 dev server
// （http://127.0.0.1:4173/output/diagnostics/...）按需转换后在浏览器内运行。
// 浅克隆（CI 默认 fetch-depth=1）拿不到历史 SHA 时调用方必须显式 skip 并写明原因。

const exec = promisify(execFile);

export const ALPHA_PARENT_SHA = "7839e5c^"; // 笔画几何留在 canvas 当前路径（被否决的修复前基线）
export const ALPHA_BASELINE_SHA = "7839e5c"; // 独立 Path2D（冻结的诊断基线，未批准交付）
const RENDERER_PATH = "src/client/features/handwriting/handwritingRenderer.ts";
const PIPELINE_PATH = "src/client/features/bible/copywork/copyworkPlaybackRenderer.ts";
const DIAG_DIR = "output/diagnostics";

export const DIAGNOSTIC_URLS = {
  rendererParent: `/${DIAG_DIR}/handwritingRenderer-7839e5c-parent.ts`,
  rendererBaseline: `/${DIAG_DIR}/handwritingRenderer-7839e5c.ts`,
  pipelineParentWired: `/${DIAG_DIR}/copyworkPlaybackRenderer-7839e5c-parentWired.ts`
} as const;

type Rewrite = { from: RegExp; to: string; original: string; label: string };

// 两份 renderer 副本共用同一组改写：相对/别名说明符 → dev server 绝对 URL。
const RENDERER_REWRITES: Rewrite[] = [
  { from: /"\.\/handwritingBrush"/g, original: '"./handwritingBrush"', to: '"/src/client/features/handwriting/handwritingBrush.ts"', label: "handwritingBrush" },
  { from: /"\.\/handwritingTrueBrush"/g, original: '"./handwritingTrueBrush"', to: '"/src/client/features/handwriting/handwritingTrueBrush.ts"', label: "handwritingTrueBrush" },
  { from: /"@shared\/handwriting"/g, original: '"@shared/handwriting"', to: '"/src/shared/handwriting.ts"', label: "@shared/handwriting" },
  { from: /"\.\/handwritingTimeline"/g, original: '"./handwritingTimeline"', to: '"/src/client/features/handwriting/handwritingTimeline.ts"', label: "handwritingTimeline" }
];

// 管线副本只在 7839e5c^ 与 7839e5c 内容一致的前提下，把 renderer 依赖接到
// parent 副本 URL 上，得到"parent renderer + 同一管线"的诊断变体。
const PIPELINE_PARENT_REWRITES: Rewrite[] = [
  { from: /"@shared\/bibleCopywork"/g, original: '"@shared/bibleCopywork"', to: '"/src/shared/bibleCopywork.ts"', label: "@shared/bibleCopywork" },
  { from: /"\.\/copyworkPageLayout"/g, original: '"./copyworkPageLayout"', to: '"/src/client/features/bible/copywork/copyworkPageLayout.ts"', label: "copyworkPageLayout" },
  { from: /"\.\.\/\.\.\/handwriting\/handwritingRenderer"/g, original: '"../../handwriting/handwritingRenderer"', to: `"${DIAGNOSTIC_URLS.rendererParent}"`, label: "renderer→parent copy" },
  { from: /"\.\.\/\.\.\/handwriting\/handwritingRenderQueue"/g, original: '"../../handwriting/handwritingRenderQueue"', to: '"/src/client/features/handwriting/handwritingRenderQueue.ts"', label: "handwritingRenderQueue" }
];

function applyRewrites(source: string, rewrites: Rewrite[]) {
  const matched: Record<string, number> = {};
  const out = rewrites.reduce((text, rule) => {
    const hits = text.match(rule.from)?.length ?? 0;
    matched[rule.label] = hits;
    return text.replace(rule.from, rule.to);
  }, source);
  return { out, matched };
}

export type DiagnosticCopies = {
  ok: boolean;
  error?: string;
  provenance: Record<string, unknown> | null;
};

export async function materializeAlphaDiagnosticCopies(): Promise<DiagnosticCopies> {
  try {
    const [parentRenderer, baselineRenderer, parentPipeline, baselinePipeline] = await Promise.all([
      exec("git", ["show", `${ALPHA_PARENT_SHA}:${RENDERER_PATH}`]),
      exec("git", ["show", `${ALPHA_BASELINE_SHA}:${RENDERER_PATH}`]),
      exec("git", ["show", `${ALPHA_PARENT_SHA}:${PIPELINE_PATH}`]),
      exec("git", ["show", `${ALPHA_BASELINE_SHA}:${PIPELINE_PATH}`])
    ]);
    if (parentPipeline.stdout !== baselinePipeline.stdout) {
      throw new Error("copyworkPlaybackRenderer differs between the two SHAs; parent wiring needs re-review");
    }
    const parentRewritten = applyRewrites(parentRenderer.stdout, RENDERER_REWRITES);
    const baselineRewritten = applyRewrites(baselineRenderer.stdout, RENDERER_REWRITES);
    const pipelineRewritten = applyRewrites(parentPipeline.stdout, PIPELINE_PARENT_REWRITES);
    for (const [label, hits] of Object.entries(parentRewritten.matched)) {
      if (!hits) throw new Error(`parent renderer rewrite matched nothing: ${label}`);
    }
    for (const [label, hits] of Object.entries(baselineRewritten.matched)) {
      if (!hits) throw new Error(`baseline renderer rewrite matched nothing: ${label}`);
    }
    for (const [label, hits] of Object.entries(pipelineRewritten.matched)) {
      if (!hits) throw new Error(`pipeline rewrite matched nothing: ${label}`);
    }
    // 溯源不变量（往返校验）：把副本里的绝对 URL 换回原始说明符后，必须与
    // `git show` 输出逐字节一致——证明改写只动了导入路径，没有动实现。
    for (const [name, raw, rewritten] of [
      ["rendererParent", parentRenderer.stdout, parentRewritten.out],
      ["rendererBaseline", baselineRenderer.stdout, baselineRewritten.out],
      ["pipelineParentWired", parentPipeline.stdout, pipelineRewritten.out]
    ] as const) {
      const roundTrip = PIPELINE_PARENT_REWRITES.concat(RENDERER_REWRITES)
        .reduce((text, rule) => text.split(rule.to).join(rule.original), rewritten);
      if (roundTrip !== raw) throw new Error(`round-trip provenance failed for ${name}`);
    }
    await fs.mkdir(path.resolve(DIAG_DIR), { recursive: true });
    await fs.writeFile(path.resolve(DIAG_DIR, "handwritingRenderer-7839e5c-parent.ts"), parentRewritten.out, "utf8");
    await fs.writeFile(path.resolve(DIAG_DIR, "handwritingRenderer-7839e5c.ts"), baselineRewritten.out, "utf8");
    await fs.writeFile(path.resolve(DIAG_DIR, "copyworkPlaybackRenderer-7839e5c-parentWired.ts"), pipelineRewritten.out, "utf8");
    return {
      ok: true,
      provenance: {
        rendererParentSource: `${ALPHA_PARENT_SHA}:${RENDERER_PATH}`,
        rendererBaselineSource: `${ALPHA_BASELINE_SHA}:${RENDERER_PATH}`,
        pipelineSource: `${ALPHA_PARENT_SHA}:${PIPELINE_PATH}`,
        pipelineIdenticalAcrossShas: true,
        rendererRewrites: { parent: parentRewritten.matched, baseline: baselineRewritten.matched },
        pipelineRewrites: pipelineRewritten.matched,
        rendererLineCounts: { parent: parentRenderer.stdout.split("\n").length, baseline: baselineRenderer.stdout.split("\n").length },
        roundTripProvenance: "rewrite-invert reproduces git show output byte-for-byte"
      }
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), provenance: null };
  }
}

export async function currentCheckoutSha(): Promise<string> {
  try {
    const { stdout } = await exec("git", ["rev-parse", "HEAD"]);
    return stdout.trim();
  } catch {
    return "unknown";
  }
}

// 回件要求记录锁文件实际版本：package.json 的声明值只是声明。
export async function lockedPlaywrightVersion(): Promise<string> {
  try {
    const lock = JSON.parse(await fs.readFile("package-lock.json", "utf8")) as {
      packages?: Record<string, { version?: string }>;
      dependencies?: Record<string, { version?: string }>;
    };
    return lock.packages?.["node_modules/@playwright/test"]?.version
      ?? lock.dependencies?.["@playwright/test"]?.version
      ?? "unknown";
  } catch {
    return "unknown";
  }
}
