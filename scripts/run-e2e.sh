#!/usr/bin/env bash
set -Eeuo pipefail

if [ -z "${E2E_DATABASE_URL:-}" ]; then
  echo "E2E_DATABASE_URL is required and must point to a local MySQL database named tm3_e2e." >&2
  exit 1
fi

export E2E_TEST_RUN=1
export NODE_ENV=test
export DATABASE_URL="$E2E_DATABASE_URL"
export JWT_SECRET="e2e-only-jwt-secret-not-for-production"
export STORAGE_ROOT="${E2E_STORAGE_ROOT:-$PWD/output/e2e/storage}"
export CORS_ORIGINS="http://127.0.0.1:4173"
export PUSH_NOTIFICATIONS_ENABLED=false
export TRUST_PROXY=false
# 整套 e2e 在一分钟内登录次数远超生产限流阈值，仅测试环境放宽。
export AUTH_LOGIN_RATE_LIMIT_MAX=1000
export API_RATE_LIMIT_MAX=100000
# zoom-announcements e2e 需要与 spec 内常量一致的测试签名密钥；该密钥仅用于
# 一次性 tm3_e2e 环境（值已在 spec 中公开），开启 webhook 路由供用例自签事件。
export ZOOM_WEBHOOK_SECRET_TOKEN="e2e-only-zoom-announcements"
export PORT=3003

npm run e2e:prepare
npx playwright test "$@"
