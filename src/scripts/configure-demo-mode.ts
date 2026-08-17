import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const action = process.argv[2];
if (action !== "enable" && action !== "disable") {
  throw new Error("用法：npm run demo:enable 或 npm run demo:disable");
}

const root = process.cwd();
const packagePath = path.join(root, "package.json");
const envPath = path.join(root, ".env");
if (!fs.existsSync(packagePath) || JSON.parse(fs.readFileSync(packagePath, "utf8")).name !== "tm3") {
  throw new Error("请在 Team Chat 项目目录中运行此命令");
}
if (!fs.existsSync(envPath)) throw new Error("没有找到 .env，请先完成服务器部署");

const original = fs.readFileSync(envPath, "utf8");
const lines = original.split(/\r?\n/);
const next: string[] = [];
let replaced = false;
for (const line of lines) {
  if (/^\s*DEMO_MODE\s*=/.test(line)) {
    if (!replaced) next.push(`DEMO_MODE=${action === "enable" ? "1" : "0"}`);
    replaced = true;
    continue;
  }
  next.push(line);
}
if (!replaced) {
  const insertion = next.length && next[next.length - 1] === "" ? next.length - 1 : next.length;
  next.splice(insertion, 0, `DEMO_MODE=${action === "enable" ? "1" : "0"}`);
}
const temporaryPath = `${envPath}.${process.pid}.tmp`;
fs.writeFileSync(temporaryPath, `${next.join("\n").replace(/\n+$/, "")}\n`, { mode: 0o600 });
fs.renameSync(temporaryPath, envPath);

const envValues = new Map<string, string>();
for (const line of next) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*["']?([^"']*)["']?\s*$/);
  if (match) envValues.set(match[1], match[2]);
}
const appName = envValues.get("UPDATE_PM2_APP") || envValues.get("APP_NAME") || "team-chat";
if (!/^[A-Za-z0-9_.-]+$/.test(appName)) throw new Error(".env 中的 PM2 应用名称无效，请手动重启服务");

const pm2Available = spawnSync("pm2", ["--version"], { stdio: "ignore" }).status === 0;
const appExists = pm2Available && spawnSync("pm2", ["describe", appName], { stdio: "ignore" }).status === 0;
if (appExists) {
  const restart = spawnSync("pm2", ["restart", appName, "--update-env"], { stdio: "inherit" });
  if (restart.status !== 0) throw new Error(`配置已写入，但 PM2 应用 ${appName} 重启失败`);
  console.log(action === "enable" ? "演示模式已在服务器端启用。请用管理员账号打开“数据与系统”。" : "演示模式入口已关闭。");
} else {
  console.log(action === "enable" ? "演示模式配置已启用。请重启 Team Chat 服务。" : "演示模式配置已关闭。请重启 Team Chat 服务。");
}
