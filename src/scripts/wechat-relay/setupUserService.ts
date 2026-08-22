import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { type RelaySetupConnection, updateRelayEnvironment } from "./setupConfig.js";

export const SYSTEM_RELAY_ENVIRONMENT_PATH = "/etc/wechat-relay.env";

export function userRelayEnvironmentPath(homeDirectory = os.homedir()) {
  return path.join(homeDirectory, ".config", "wechat-relay.env");
}

export function resolveRelaySetupEnvironmentPath(
  systemPath = SYSTEM_RELAY_ENVIRONMENT_PATH,
  homeDirectory = os.homedir()
) {
  if (fs.existsSync(systemPath)) return systemPath;
  const userPath = userRelayEnvironmentPath(homeDirectory);
  return fs.existsSync(userPath) ? userPath : systemPath;
}

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

function restartUserRelayService() {
  const restarted = spawnSync("/usr/bin/systemctl", ["--user", "restart", "wechat-relay.service"], {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 16_384
  });
  if (restarted.status !== 0) throw new Error("无法重启当前用户的微信转发服务");
  const active = spawnSync("/usr/bin/systemctl", ["--user", "is-active", "--quiet", "wechat-relay.service"], {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 16_384
  });
  if (active.status !== 0) throw new Error("微信转发服务启动后未保持运行");
}

export function applyUserRelayConnection(
  connection: RelaySetupConnection,
  environmentPath: string,
  restart: () => void = restartUserRelayService
) {
  if (!fs.existsSync(environmentPath)) throw new Error("未找到当前用户的微信转发配置");
  const metadata = fs.statSync(environmentPath);
  const currentUid = typeof process.getuid === "function" ? process.getuid() : metadata.uid;
  if (metadata.uid !== currentUid || !metadata.isFile()) {
    throw new Error("当前用户无权修改微信转发配置");
  }
  const previous = fs.readFileSync(environmentPath, "utf8");
  const updated = updateRelayEnvironment(previous, connection);
  atomicWrite(`${environmentPath}.before-setup`, previous, metadata);
  atomicWrite(environmentPath, updated, metadata);
  try {
    restart();
  } catch (error) {
    atomicWrite(environmentPath, previous, metadata);
    try {
      restart();
    } catch {
      // Preserve the original configuration even if its pre-existing service cannot restart.
    }
    throw error;
  }
}
