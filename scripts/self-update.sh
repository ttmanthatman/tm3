#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-$(pwd)}"
REPO_URL="${UPDATE_REPO_URL:-${REPO_URL:-https://github.com/ttmanthatman/tm3.git}}"
BRANCH="${UPDATE_BRANCH:-${BRANCH:-main}}"
PM2_APP="${UPDATE_PM2_APP:-${APP_NAME:-team-chat}}"
STATUS_PATH="${UPDATE_STATUS_PATH:-${APP_DIR}/storage/update-status.json}"
LOG_PATH="${UPDATE_LOG_PATH:-${APP_DIR}/storage/update.log}"

mkdir -p "$(dirname "$STATUS_PATH")" "$(dirname "$LOG_PATH")"

write_status() {
  local state="$1"
  local progress="$2"
  local detail="$3"
  UPDATE_STATE="$state" UPDATE_PROGRESS="$progress" UPDATE_DETAIL="$detail" UPDATE_STATUS_PATH="$STATUS_PATH" node --input-type=module <<'NODE'
import fs from "node:fs";
const payload = {
  state: process.env.UPDATE_STATE,
  progress: Number(process.env.UPDATE_PROGRESS || 0),
  detail: process.env.UPDATE_DETAIL || "",
  updatedAt: new Date().toISOString()
};
fs.writeFileSync(process.env.UPDATE_STATUS_PATH, `${JSON.stringify(payload, null, 2)}\n`);
NODE
}

log_step() {
  local progress="$1"
  local detail="$2"
  printf '[%s] %s\n' "$(date -Iseconds)" "$detail" >>"$LOG_PATH"
  write_status "running" "$progress" "$detail"
}

trap 'code=$?; printf "[%s] 更新失败，退出码 %s\n" "$(date -Iseconds)" "$code" >>"$LOG_PATH"; write_status "failed" 100 "更新失败，退出码 ${code}"' ERR

: >"$LOG_PATH"
write_status "running" 1 "准备更新"

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

log_step 8 "下载最新代码"
git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$TMP_DIR/repo" >>"$LOG_PATH" 2>&1

log_step 22 "同步应用文件"
rsync -a --delete \
  --exclude ".git" \
  --exclude ".env" \
  --exclude "node_modules" \
  --exclude "storage" \
  --exclude "dist" \
  --exclude "AGENTS.md" \
  "$TMP_DIR/repo"/ "$APP_DIR"/ >>"$LOG_PATH" 2>&1

cd "$APP_DIR"

log_step 42 "安装依赖"
npm ci >>"$LOG_PATH" 2>&1

log_step 58 "生成 Prisma Client"
npm run prisma:generate >>"$LOG_PATH" 2>&1

log_step 68 "同步数据库结构"
npm run prisma:push >>"$LOG_PATH" 2>&1

log_step 82 "构建前端和服务端"
npm run build >>"$LOG_PATH" 2>&1

log_step 94 "重启服务"
pm2 restart "$PM2_APP" --update-env >>"$LOG_PATH" 2>&1
pm2 save >>"$LOG_PATH" 2>&1

printf '[%s] 更新完成\n' "$(date -Iseconds)" >>"$LOG_PATH"
write_status "complete" 100 "更新完成"
