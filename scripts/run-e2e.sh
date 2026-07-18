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
export PORT=3003

npm run e2e:prepare
npx playwright test "$@"
