#!/usr/bin/env bash
set -Eeuo pipefail

if [ "${MIGRATION_VERIFY_RUN:-}" != "1" ]; then
  echo "MIGRATION_VERIFY_RUN=1 is required for the disposable migration verification database." >&2
  exit 1
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required for migration verification." >&2
  exit 1
fi

node --input-type=module <<'NODE'
import { PrismaClient } from "@prisma/client";

const parsed = new URL(process.env.DATABASE_URL);
const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);

if (
  parsed.protocol !== "mysql:" ||
  !localHosts.has(parsed.hostname) ||
  database !== "tm3_migration_verify"
) {
  throw new Error(
    "Migration verification requires a local MySQL database named tm3_migration_verify."
  );
}

const prisma = new PrismaClient();
try {
  const tables = await prisma.$queryRawUnsafe(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()"
  );
  if (tables.length !== 0) {
    throw new Error("Migration verification database must be empty before apply.");
  }
} finally {
  await prisma.$disconnect();
}
NODE

npx prisma migrate deploy
npx prisma migrate status
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --exit-code

node --input-type=module <<'NODE'
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
try {
  const migrations = await prisma.$queryRawUnsafe(
    "SELECT migration_name, finished_at, rolled_back_at, applied_steps_count FROM _prisma_migrations ORDER BY started_at ASC"
  );
  if (
    migrations.length !== 1 ||
    migrations[0].migration_name !== "0_init" ||
    !migrations[0].finished_at ||
    migrations[0].rolled_back_at !== null ||
    Number(migrations[0].applied_steps_count) !== 1
  ) {
    throw new Error("Expected one successfully applied 0_init migration.");
  }
} finally {
  await prisma.$disconnect();
}
NODE

echo "Prisma migration baseline verified on the disposable database."
