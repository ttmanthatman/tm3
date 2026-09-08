import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { APP_VERSION } from "../../shared/release.js";
import { ROOT, STORAGE_ROOT } from "../storageDirs.js";
import { githubPackageManifestUrl } from "../updateManifest.js";
import { availableDefaultUpdateBranch, isSafeUpdateBranch, normalizeUpdateBranches, selectUpdateBranch } from "../updateBranches.js";

export const UPDATE_REPO_URL = process.env.UPDATE_REPO_URL || process.env.REPO_URL || "https://github.com/ttmanthatman/tm3.git";
const DEFAULT_UPDATE_BRANCH = process.env.UPDATE_BRANCH || process.env.BRANCH || "main";
export const UPDATE_PM2_APP = process.env.UPDATE_PM2_APP || process.env.APP_NAME || "team-chat";
export const UPDATE_RESTART_MODE = process.env.UPDATE_RESTART_MODE || (process.env.UPDATE_RESTART_COMMAND ? "command" : "pm2");
const UPDATE_RESTART_COMMAND = process.env.UPDATE_RESTART_COMMAND || "";
const UPDATE_STATUS_PATH = path.join(STORAGE_ROOT, "update-status.json");
const UPDATE_LOG_PATH = path.join(STORAGE_ROOT, "update.log");
const UPDATE_BRANCH_CONFIG_PATH = process.env.UPDATE_BRANCH_CONFIG_PATH || path.join(STORAGE_ROOT, "update-branch.json");
const UPDATE_RUNNING_TIMEOUT_MS = Number(process.env.UPDATE_RUNNING_TIMEOUT_MS || 30 * 60 * 1000);
const UPDATE_LOG_TAIL_BYTES = Math.max(64 * 1024, Number(process.env.UPDATE_LOG_TAIL_BYTES || 256 * 1024) || 256 * 1024);

function compareVersions(a: string, b: string) {
  const left = a.split(".").map((part) => Number(part.replace(/\D.*/, "")) || 0);
  const right = b.split(".").map((part) => Number(part.replace(/\D.*/, "")) || 0);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

function parseGitHubRepo(url: string) {
  const trimmed = url.trim().replace(/\.git$/, "");
  const ssh = trimmed.match(/github\.com[:/]([^/]+)\/([^/]+)$/);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };
  try {
    const parsed = new URL(trimmed);
    if (!/github\.com$/i.test(parsed.hostname)) return null;
    const [owner, repo] = parsed.pathname.replace(/^\/+/, "").split("/");
    return owner && repo ? { owner, repo } : null;
  } catch {
    return null;
  }
}

export function configuredUpdateBranch() {
  try {
    const value = JSON.parse(fs.readFileSync(UPDATE_BRANCH_CONFIG_PATH, "utf8")) as { branch?: unknown };
    return typeof value.branch === "string" && isSafeUpdateBranch(value.branch) ? value.branch : DEFAULT_UPDATE_BRANCH;
  } catch {
    return DEFAULT_UPDATE_BRANCH;
  }
}

async function githubBranches() {
  const repo = parseGitHubRepo(UPDATE_REPO_URL);
  if (!repo) throw new Error("只支持 GitHub 仓库更新地址");
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/branches?per_page=100`, {
    cache: "no-store",
    headers: { accept: "application/vnd.github+json", "user-agent": "team-chat-updater" }
  });
  if (!response.ok) throw new Error(`无法读取 GitHub 分支：HTTP ${response.status}`);
  const payload = await response.json() as unknown;
  if (!Array.isArray(payload)) throw new Error("GitHub 分支列表无效");
  const branches = normalizeUpdateBranches(payload.map((item) => typeof item === "object" && item ? (item as { name?: unknown }).name : undefined));
  if (!branches.length) throw new Error("GitHub 没有可用更新分支");
  return { repo, branches };
}

async function latestGitHubPackage(branch: string) {
  const repo = parseGitHubRepo(UPDATE_REPO_URL);
  if (!repo) throw new Error("只支持 GitHub 仓库更新地址");
  const url = githubPackageManifestUrl(repo.owner, repo.repo, branch);
  const response = await fetch(url, {
    cache: "no-store",
    headers: { accept: "application/vnd.github+json", "user-agent": "team-chat-updater" }
  });
  if (!response.ok) throw new Error(`无法读取 GitHub 版本：HTTP ${response.status}`);
  const manifest = (await response.json()) as { content?: string; encoding?: string };
  if (!manifest.content || manifest.encoding !== "base64") throw new Error("GitHub package.json 内容无效");
  const pkg = JSON.parse(Buffer.from(manifest.content, "base64").toString("utf8")) as { version?: string };
  if (!pkg.version || !/^\d+\.\d+\.\d+/.test(pkg.version)) throw new Error("GitHub package.json 缺少有效版本号");
  return {
    owner: repo.owner,
    repo: repo.repo,
    branch,
    version: String(pkg.version || ""),
    url: `https://github.com/${repo.owner}/${repo.repo}`
  };
}

function expireStaleUpdateStatus(status: { state: string; progress: number; detail: string; updatedAt?: string }) {
  if (status.state !== "running" || !status.updatedAt || !Number.isFinite(UPDATE_RUNNING_TIMEOUT_MS) || UPDATE_RUNNING_TIMEOUT_MS <= 0) {
    return status;
  }
  const updatedAt = Date.parse(status.updatedAt);
  if (!Number.isFinite(updatedAt) || Date.now() - updatedAt <= UPDATE_RUNNING_TIMEOUT_MS) return status;
  return {
    ...status,
    state: "failed",
    progress: 100,
    detail: "更新进程长时间没有进展，请检查日志后重试"
  };
}

function readUpdateStatus() {
  let status: { state: string; progress: number; detail: string; updatedAt?: string } = { state: "idle", progress: 0, detail: "尚未开始更新" };
  if (fs.existsSync(UPDATE_STATUS_PATH)) {
    try {
      status = { ...status, ...JSON.parse(fs.readFileSync(UPDATE_STATUS_PATH, "utf8")) };
    } catch {
      status = { state: "unknown", progress: 0, detail: "更新状态文件无法读取" };
    }
  }
  const log = readLogTail(UPDATE_LOG_PATH, UPDATE_LOG_TAIL_BYTES);
  return { ...expireStaleUpdateStatus(status), log };
}

function writeUpdateStatus(state: string, progress: number, detail: string) {
  fs.mkdirSync(STORAGE_ROOT, { recursive: true });
  const payload = {
    state,
    progress: Math.min(100, Math.max(0, Number(progress) || 0)),
    detail: detail.slice(0, 500),
    updatedAt: new Date().toISOString()
  };
  const tempPath = `${UPDATE_STATUS_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`);
  fs.renameSync(tempPath, UPDATE_STATUS_PATH);
}

function readLogTail(filePath: string, maxBytes: number) {
  if (!fs.existsSync(filePath)) return [];
  const stat = fs.statSync(filePath);
  const start = Math.max(0, stat.size - maxBytes);
  const length = stat.size - start;
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    const text = `${start > 0 ? "...日志过长，仅显示最后部分\n" : ""}${buffer.toString("utf8")}`;
    return text.split(/\r?\n/).filter(Boolean).slice(-120);
  } finally {
    fs.closeSync(fd);
  }
}

export function registerAdminUpdateRoutes(app: FastifyInstance, deps: { requireAdmin: preHandlerHookHandler }) {
  const { requireAdmin } = deps;

  app.get("/api/admin/update/check", { preHandler: requireAdmin }, async (request) => {
    const { repo, branches } = await githubBranches();
    const fallbackBranch = availableDefaultUpdateBranch(branches, configuredUpdateBranch(), DEFAULT_UPDATE_BRANCH);
    const branch = selectUpdateBranch((request.query as { branch?: unknown }).branch, branches, fallbackBranch);
    const latest = await latestGitHubPackage(branch);
    return {
      current: APP_VERSION,
      latest: latest.version,
      updateAvailable: latest.branch !== configuredUpdateBranch() || compareVersions(latest.version, APP_VERSION) > 0,
      repo: `${repo.owner}/${repo.repo}`,
      branch: latest.branch,
      branches,
      url: latest.url,
      restartMode: UPDATE_RESTART_MODE,
      status: readUpdateStatus()
    };
  });

  app.get("/api/admin/update/status", { preHandler: requireAdmin }, async () => readUpdateStatus());

  app.post("/api/admin/update/start", { preHandler: requireAdmin }, async (request, reply) => {
    const status = readUpdateStatus();
    if (status.state === "running") return reply.code(409).send({ success: false, message: "更新已经在进行中", status });
    const { branches } = await githubBranches();
    const fallbackBranch = availableDefaultUpdateBranch(branches, configuredUpdateBranch(), DEFAULT_UPDATE_BRANCH);
    const branch = selectUpdateBranch((request.body as { branch?: unknown } | undefined)?.branch, branches, fallbackBranch);
    const scriptPath = path.join(ROOT, "scripts", "self-update.sh");
    if (!fs.existsSync(scriptPath)) return reply.code(500).send({ success: false, message: "缺少更新脚本" });
    fs.writeFileSync(UPDATE_LOG_PATH, "");
    writeUpdateStatus("running", 1, `准备更新 ${branch}`);
    const child = spawn("bash", [scriptPath], {
      cwd: ROOT,
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        APP_DIR: ROOT,
        UPDATE_REPO_URL,
        UPDATE_BRANCH: branch,
        UPDATE_PM2_APP,
        UPDATE_RESTART_MODE,
        UPDATE_RESTART_COMMAND,
        UPDATE_STATUS_PATH,
        UPDATE_LOG_PATH,
        UPDATE_BRANCH_CONFIG_PATH
      }
    });
    child.on("error", (error) => {
      const detail = `启动更新脚本失败：${error.message}`;
      fs.appendFileSync(UPDATE_LOG_PATH, `[${new Date().toISOString()}] ${detail}\n`);
      writeUpdateStatus("failed", 100, detail);
    });
    child.unref();
    return { success: true, status: readUpdateStatus() };
  });
}
