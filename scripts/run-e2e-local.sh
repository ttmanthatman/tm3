#!/usr/bin/env bash
set -Eeuo pipefail

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Docker with Compose is required for npm run test:e2e:local." >&2
  exit 1
fi

compose=(docker compose -p tm3-e2e -f e2e/docker-compose.yml)

cleanup() {
  "${compose[@]}" down --volumes --remove-orphans
}
trap cleanup EXIT

"${compose[@]}" up --detach --wait
export E2E_DATABASE_URL="mysql://tm3_e2e:tm3_e2e@127.0.0.1:33306/tm3_e2e"
npm run test:e2e
