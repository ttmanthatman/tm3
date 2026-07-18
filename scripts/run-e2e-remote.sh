#!/usr/bin/env bash
set -Eeuo pipefail

credentials_file="${REMOTE_E2E_ENV_FILE:-$PWD/.env.remote-e2e.local}"
if [ -f "$credentials_file" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$credentials_file"
  set +a
fi

node --import tsx --input-type=module -e 'import { remoteE2EEnvironment } from "./e2e-remote/safety.ts"; remoteE2EEnvironment();'
exec npx playwright test --config playwright.remote.config.ts "$@"
