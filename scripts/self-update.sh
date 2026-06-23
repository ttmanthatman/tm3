#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-$(pwd)}"
REPO_URL="${UPDATE_REPO_URL:-${REPO_URL:-https://github.com/ttmanthatman/tm3.git}}"
BRANCH="${UPDATE_BRANCH:-${BRANCH:-main}}"
PM2_APP="${UPDATE_PM2_APP:-${APP_NAME:-team-chat}}"
STATUS_PATH="${UPDATE_STATUS_PATH:-${APP_DIR}/storage/update-status.json}"
LOG_PATH="${UPDATE_LOG_PATH:-${APP_DIR}/storage/update.log}"
CLONE_ATTEMPTS="${UPDATE_CLONE_ATTEMPTS:-3}"

if [ "${SELF_UPDATE_RUNNER_COPY:-}" != "1" ]; then
  runner_copy="$(mktemp "${TMPDIR:-/tmp}/team-chat-self-update.XXXXXX.sh")"
  cp "$0" "$runner_copy"
  chmod 700 "$runner_copy"
  SELF_UPDATE_RUNNER_COPY=1 SELF_UPDATE_RUNNER_PATH="$runner_copy" exec bash "$runner_copy"
fi

mkdir -p "$(dirname "$STATUS_PATH")" "$(dirname "$LOG_PATH")"
export NPM_CONFIG_CACHE="${NPM_CONFIG_CACHE:-${APP_DIR}/storage/npm-cache}"
mkdir -p "$NPM_CONFIG_CACHE"

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

CURRENT_STEP="准备更新"

log_step() {
  local progress="$1"
  local detail="$2"
  CURRENT_STEP="$detail"
  printf '[%s] %s\n' "$(date -Iseconds)" "$detail" >>"$LOG_PATH"
  write_status "running" "$progress" "$detail"
}

fail_step() {
  local detail="$1"
  printf '[%s] %s\n' "$(date -Iseconds)" "$detail" >>"$LOG_PATH"
  write_status "failed" 100 "$detail"
  exit 1
}

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    fail_step "更新失败：服务器缺少 ${command_name} 命令"
  fi
}

run_logged() {
  local progress="$1"
  local detail="$2"
  shift 2
  log_step "$progress" "$detail"
  "$@" >>"$LOG_PATH" 2>&1
}

clone_repo() {
  local attempt=1
  local max_attempts="$CLONE_ATTEMPTS"
  if ! [[ "$max_attempts" =~ ^[0-9]+$ ]] || [ "$max_attempts" -lt 1 ]; then
    max_attempts=3
  fi

  log_step 8 "检查 GitHub 连接"
  git ls-remote --exit-code --heads "$REPO_URL" "$BRANCH" >>"$LOG_PATH" 2>&1

  while [ "$attempt" -le "$max_attempts" ]; do
    log_step 12 "下载最新代码（第 ${attempt}/${max_attempts} 次）"
    if git clone --depth 1 --single-branch --branch "$BRANCH" "$REPO_URL" "$RELEASE_DIR" >>"$LOG_PATH" 2>&1; then
      return 0
    fi
    if [ "$attempt" -lt "$max_attempts" ]; then
      printf '[%s] 下载失败，5 秒后重试\n' "$(date -Iseconds)" >>"$LOG_PATH"
      rm -rf "$RELEASE_DIR"
      sleep 5
    fi
    attempt=$((attempt + 1))
  done
  return 1
}

trap 'code=$?; printf "[%s] 更新失败：%s，退出码 %s\n" "$(date -Iseconds)" "$CURRENT_STEP" "$code" >>"$LOG_PATH"; write_status "failed" 100 "更新失败：${CURRENT_STEP}（退出码 ${code}）"' ERR

: >"$LOG_PATH"
write_status "running" 1 "准备更新"

TMP_DIR="$(mktemp -d)"
RELEASE_DIR="$TMP_DIR/repo"
cleanup() {
  rm -rf "$TMP_DIR"
  if [ -n "${SELF_UPDATE_RUNNER_PATH:-}" ]; then
    rm -f "$SELF_UPDATE_RUNNER_PATH"
  fi
}
trap cleanup EXIT

log_step 4 "检查更新环境"
require_command git
require_command rsync
require_command npm
require_command node
require_command pm2

if [ -z "$REPO_URL" ]; then
  fail_step "更新失败：未配置 GitHub 仓库地址"
fi
if [ -z "$BRANCH" ]; then
  fail_step "更新失败：未配置 GitHub 分支"
fi
if [ ! -d "$APP_DIR" ]; then
  fail_step "更新失败：应用目录不存在：${APP_DIR}"
fi
if [ ! -w "$APP_DIR" ]; then
  fail_step "更新失败：当前用户不能写入应用目录：${APP_DIR}"
fi

clone_repo

if [ ! -f "$RELEASE_DIR/package.json" ] || [ ! -f "$RELEASE_DIR/package-lock.json" ]; then
  fail_step "更新失败：GitHub 代码缺少 package.json 或 package-lock.json"
fi

if [ -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env" "$RELEASE_DIR/.env"
fi

cd "$RELEASE_DIR"

run_logged 32 "安装依赖" npm ci --no-audit --no-fund
run_logged 52 "生成 Prisma Client" npm run prisma:generate
run_logged 64 "同步数据库结构" npm run prisma:push
run_logged 78 "构建前端和服务端" npm run build

log_step 88 "同步应用文件"
rsync -a --delete \
  --exclude ".git" \
  --exclude ".env" \
  --exclude "storage" \
  --exclude "AGENTS.md" \
  "$RELEASE_DIR"/ "$APP_DIR"/ >>"$LOG_PATH" 2>&1

cd "$APP_DIR"

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
