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

restart_cmd=(bash)
if command -v setsid >/dev/null 2>&1; then
  restart_cmd=(setsid bash)
fi

UPDATE_PM2_APP="$PM2_APP" UPDATE_STATUS_PATH="$STATUS_PATH" UPDATE_LOG_PATH="$LOG_PATH" nohup "${restart_cmd[@]}" -c '
set +e
sleep 1
printf "[%s] 执行 PM2 重启\n" "$(date -Iseconds)" >>"$UPDATE_LOG_PATH"
pm2 restart "$UPDATE_PM2_APP" --update-env >>"$UPDATE_LOG_PATH" 2>&1
restart_code=$?
if [ "$restart_code" -eq 0 ]; then
  pm2 save >>"$UPDATE_LOG_PATH" 2>&1
  save_code=$?
else
  save_code=0
fi

if [ "$restart_code" -eq 0 ] && [ "$save_code" -eq 0 ]; then
  detail="更新完成"
  state="complete"
  progress="100"
  printf "[%s] 更新完成\n" "$(date -Iseconds)" >>"$UPDATE_LOG_PATH"
else
  if [ "$restart_code" -ne 0 ]; then
    detail="重启服务失败，退出码 ${restart_code}"
    code="$restart_code"
  else
    detail="保存 PM2 配置失败，退出码 ${save_code}"
    code="$save_code"
  fi
  state="failed"
  progress="100"
  printf "[%s] %s\n" "$(date -Iseconds)" "$detail" >>"$UPDATE_LOG_PATH"
fi

UPDATE_STATE="$state" UPDATE_PROGRESS="$progress" UPDATE_DETAIL="$detail" node --input-type=module <<'"'"'NODE'"'"'
import fs from "node:fs";
const payload = {
  state: process.env.UPDATE_STATE,
  progress: Number(process.env.UPDATE_PROGRESS || 0),
  detail: process.env.UPDATE_DETAIL || "",
  updatedAt: new Date().toISOString()
};
fs.writeFileSync(process.env.UPDATE_STATUS_PATH, `${JSON.stringify(payload, null, 2)}\n`);
NODE

exit "${code:-0}"
' >/dev/null 2>&1 &

printf '[%s] 已交给独立进程重启服务\n' "$(date -Iseconds)" >>"$LOG_PATH"
