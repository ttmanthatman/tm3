import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolveRelaySetupInput, updateRelayEnvironment } from "./setupConfig.js";

const ENVIRONMENT_PATH = "/etc/wechat-relay.env";
const BACKUP_PATH = `${ENVIRONMENT_PATH}.before-setup`;
const SERVICE_NAME = "wechat-relay.service";

function atomicWrite(filePath: string, content: string, metadata: fs.Stats) {
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(temporaryPath, content, { encoding: "utf8", mode: metadata.mode & 0o777 });
    fs.chownSync(temporaryPath, metadata.uid, metadata.gid);
    fs.chmodSync(temporaryPath, metadata.mode & 0o777);
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

function systemctl(...args: string[]) {
  return spawnSync("/usr/bin/systemctl", args, { encoding: "utf8", timeout: 30_000, maxBuffer: 16_384 });
}

function restartRelayService() {
  const restarted = systemctl("restart", SERVICE_NAME);
  if (restarted.status !== 0) throw new Error("无法重启微信转发服务");
  const active = systemctl("is-active", "--quiet", SERVICE_NAME);
  if (active.status !== 0) throw new Error("微信转发服务启动后未保持运行");
}

function readInput() {
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    throw new Error("连接配置格式不正确");
  }
  if (!value || typeof value !== "object") throw new Error("连接配置格式不正确");
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.baseUrl !== "string" || typeof candidate.token !== "string") {
    throw new Error("连接配置缺少聊天室地址或令牌");
  }
  return { baseUrl: candidate.baseUrl, token: candidate.token };
}

function main() {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) {
    throw new Error("保存配置需要虚拟机管理员授权");
  }
  if (!fs.existsSync(ENVIRONMENT_PATH)) {
    throw new Error("未找到 /etc/wechat-relay.env，请先完成一次 NAS 转发服务安装");
  }

  const metadata = fs.statSync(ENVIRONMENT_PATH);
  const existingEnvironment = fs.readFileSync(ENVIRONMENT_PATH, "utf8");
  const input = readInput();
  const connection = resolveRelaySetupInput(input, existingEnvironment);
  const updatedEnvironment = updateRelayEnvironment(existingEnvironment, connection);

  atomicWrite(BACKUP_PATH, existingEnvironment, metadata);
  atomicWrite(ENVIRONMENT_PATH, updatedEnvironment, metadata);
  try {
    restartRelayService();
  } catch (error) {
    atomicWrite(ENVIRONMENT_PATH, existingEnvironment, metadata);
    try {
      restartRelayService();
    } catch {
      // The original configuration is restored even if the pre-existing service cannot start.
    }
    throw error;
  }

  process.stdout.write(`${JSON.stringify({
    success: true,
    baseUrl: connection.baseUrl,
    databasePath: connection.databasePath
  })}\n`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : "保存连接失败";
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
