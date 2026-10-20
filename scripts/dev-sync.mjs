import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

function git(args, { allowFailure = false } = {}) {
  const result = spawnSync("git", ["--no-optional-locks", "-c", "gc.auto=0", "-c", "maintenance.auto=false", ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    maxBuffer: 8 * 1024 * 1024
  });
  if (result.error) throw new Error(`无法运行 Git：${result.error.message}`);
  if (result.status !== 0 && !allowFailure) {
    throw new Error(result.stderr.trim() || `Git 命令失败（退出码 ${result.status}）。`);
  }
  return { ok: result.status === 0, output: result.stdout.trimEnd() };
}

function readState() {
  const branch = git(["symbolic-ref", "--quiet", "--short", "HEAD"], { allowFailure: true }).output;
  const head = git(["rev-parse", "--verify", "HEAD"]).output;
  const upstreamParts = branch
    ? git(["for-each-ref", "--format=%(upstream)%00%(upstream:short)%00%(upstream:remotename)%00%(upstream:remoteref)", `refs/heads/${branch}`]).output.split("\0")
    : [];
  const upstream = upstreamParts[0] ? {
    ref: upstreamParts[0], name: upstreamParts[1], remote: upstreamParts[2], source: upstreamParts[3]
  } : null;
  const dirty = git(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"]).output;
  const operations = [
    ["MERGE_HEAD", "合并"], ["rebase-merge", "变基"], ["rebase-apply", "变基/补丁应用"],
    ["CHERRY_PICK_HEAD", "拣选提交"], ["REVERT_HEAD", "撤销提交"],
    ["sequencer", "拣选/撤销序列"], ["BISECT_LOG", "二分排查"]
  ].filter(([marker]) => existsSync(path.resolve(git(["rev-parse", "--git-path", marker]).output)))
    .map(([, label]) => label);
  return { branch, head, upstream, dirty, operations };
}

function counts(state) {
  if (!state.upstream) return null;
  const result = git(["rev-list", "--left-right", "--count", `${state.head}...${state.upstream.ref}`], { allowFailure: true });
  if (!result.ok) return null;
  const [ahead, behind] = result.output.split(/\s+/).map(Number);
  return { ahead, behind };
}

function showState(state) {
  console.log(`分支：${state.branch || "游离 HEAD"}`);
  console.log(`提交：${state.head.slice(0, 12)}（${state.head}）`);
  console.log(`上游：${state.upstream?.name || "未配置"}`);
  const difference = counts(state);
  console.log(`领先/落后：${difference ? `${difference.ahead}/${difference.behind}` : "不可用"}（仅依据本地缓存；未联网）`);
  console.log(`操作状态：${state.operations.join("、") || "无进行中的操作"}`);
  const entries = state.dirty.split("\0").filter(Boolean);
  if (!entries.length) {
    console.log("工作区：干净");
    return;
  }
  console.log("工作区：有未提交或未跟踪文件");
  let shown = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const renamed = /^[RC]|^.[RC]/.test(entry);
    const previous = renamed ? entries[++index] : null;
    if (shown++ < 20) console.log(`  ${entry.slice(0, 2)} ${previous ? `${JSON.stringify(previous)} → ` : ""}${JSON.stringify(entry.slice(3))}`);
  }
  if (shown > 20) console.log(`  另有 ${shown - 20} 个文件`);
}

function requireSafeState(state) {
  if (!state.branch) throw new Error("当前为游离 HEAD。请先回到准备同步的分支，再运行 dev:sync。");
  if (state.operations.length) throw new Error(`正在进行${state.operations.join("、")}。请先完成或退出该操作，再同步。`);
  if (state.dirty) throw new Error("工作区有未提交或未跟踪文件。请先按交接流程保管好当前工作，再同步；不会自动提交、暂存或清理。");
  if (!state.upstream) throw new Error("当前分支未配置上游。请先确认交接分支并为它设置 upstream，再同步。");
  if (state.upstream.remote === "." || !state.upstream.remote || !state.upstream.source || !state.upstream.ref.startsWith("refs/remotes/")) {
    throw new Error("上游必须是远程跟踪分支；不支持本地 remote '.'。请确认当前分支的 upstream 配置。");
  }
}

function sync(initial) {
  requireSafeState(initial);
  const { upstream } = initial;
  console.log(`获取 ${upstream.remote} 的 ${upstream.source}…`);
  try {
    // An explicit destination prevents unusual remote refspecs from updating local branches.
    git(["fetch", "--no-tags", "--no-recurse-submodules", "--no-write-fetch-head", "--", upstream.remote, `+${upstream.source}:${upstream.ref}`]);
  } catch (error) {
    throw new Error(`获取上游失败，已停止同步；不会使用旧缓存快进。请检查网络和远程访问后重试。\n${error.message}`);
  }
  const current = readState();
  requireSafeState(current);
  if (current.branch !== initial.branch || current.head !== initial.head || JSON.stringify(current.upstream) !== JSON.stringify(upstream)) {
    throw new Error("获取期间分支、提交或上游发生变化。请暂停其他 Git 操作，检查 dev:status 后重试。");
  }
  const difference = counts(current);
  if (!difference) throw new Error("无法读取最新上游提交。请检查 upstream 配置后重试。");
  if (difference.ahead) {
    throw new Error(difference.behind
      ? `本地与上游已分叉（领先 ${difference.ahead}，落后 ${difference.behind}）。请先人工确认两端提交并完成整合，再同步。`
      : `本地领先上游 ${difference.ahead} 个提交。请先确认这些提交；仅在已获授权时按交接流程推送，再同步。`);
  }
  if (!difference.behind) {
    console.log(`已是最新：${current.branch} ${current.head.slice(0, 12)}`);
    return;
  }
  const target = git(["rev-parse", "--verify", upstream.ref]).output;
  try {
    git(["-c", "merge.autoStash=false", "merge", "--ff-only", "--no-edit", "--no-stat", "--no-overwrite-ignore", target]);
  } catch (error) {
    throw new Error(`快进未完成。请检查 Git 提示和 dev:status 后处理；不会自动重置或变基。\n${error.message}`);
  }
  console.log(`已快进 ${difference.behind} 个提交：${current.branch} ${target.slice(0, 12)}`);
}

try {
  const args = process.argv.slice(2);
  const command = args[0] || "status";
  if (args.length > 1 || !["status", "sync"].includes(command)) throw new Error("用法：node scripts/dev-sync.mjs [status|sync]");
  if (git(["rev-parse", "--is-inside-work-tree"]).output !== "true") throw new Error("请在 Git 工作区运行此命令。");
  const state = readState();
  if (command === "status") showState(state);
  else sync(state);
} catch (error) {
  console.error(`同步工具：${error.message}`);
  process.exitCode = 1;
}
