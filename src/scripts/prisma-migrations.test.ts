import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsRoot = path.join(root, "prisma/migrations");
const initialMigrationPath = path.join(migrationsRoot, "0_init/migration.sql");
const schemaPath = path.join(root, "prisma/schema.prisma");
const databaseVerifierPath = path.join(root, "scripts/verify-prisma-migrations.sh");

function migrationDirectories() {
  return fs
    .readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

test("migration history starts with an immutable, ordered 0_init baseline", () => {
  assert.equal(fs.existsSync(initialMigrationPath), true);
  assert.ok(fs.statSync(initialMigrationPath).size > 0);

  const directories = migrationDirectories();
  assert.equal(directories[0], "0_init");
  assert.equal(new Set(directories).size, directories.length);

  for (const [index, directory] of directories.entries()) {
    if (index > 0) {
      assert.match(directory, /^\d{14}_[a-z0-9][a-z0-9_-]*$/);
    }
    const migrationPath = path.join(migrationsRoot, directory, "migration.sql");
    assert.equal(fs.existsSync(migrationPath), true, `${directory} must contain migration.sql`);
    assert.ok(fs.statSync(migrationPath).size > 0, `${directory}/migration.sql must not be empty`);
  }
});

test("0_init is generated from the current schema and contains no destructive or private SQL", () => {
  const sql = fs.readFileSync(initialMigrationPath, "utf8");
  const schema = fs.readFileSync(schemaPath, "utf8");
  const forbidden = [
    /\bDROP\b/i,
    /\bTRUNCATE\b/i,
    /^\s*DELETE\s+FROM\b/im,
    /^\s*INSERT\s+INTO\b/im,
    /^\s*UPDATE\s+/im,
    /\bCREATE\s+DATABASE\b/i,
    /\bUSE\s+[`"]?[a-z0-9_-]+/i,
    /DATABASE_URL/i,
    /mysql:\/\//i,
    /https?:\/\//i,
    /teamchat_demo/i,
    /tm3_e2e/i
  ];

  for (const pattern of forbidden) {
    assert.doesNotMatch(sql, pattern);
  }

  const tableNames = [...sql.matchAll(/CREATE TABLE `([^`]+)`/g)].map((match) => match[1]);
  const modelTableNames = [...schema.matchAll(/model\s+\w+\s+\{([\s\S]*?)\n\}/g)].map(
    (match) => {
      const mapped = match[1].match(/@@map\("([^"]+)"\)/);
      assert.ok(mapped, "every model must declare its database table name");
      return mapped[1];
    }
  );

  assert.deepEqual([...tableNames].sort(), [...modelTableNames].sort());
  assert.equal(
    (sql.match(/DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci/g) || []).length,
    tableNames.length
  );
  assert.equal((sql.match(/^\s+PRIMARY KEY /gm) || []).length, tableNames.length);
  assert.ok((sql.match(/^\s+(?:UNIQUE )?INDEX /gm) || []).length > 0);
  assert.ok((sql.match(/^ALTER TABLE .* FOREIGN KEY /gm) || []).length > 0);
  assert.ok(sql.indexOf("ALTER TABLE") > sql.lastIndexOf("CREATE TABLE"));

  const prismaCli = path.join(root, "node_modules/prisma/build/index.js");
  const generated = spawnSync(
    process.execPath,
    [
      prismaCli,
      "migrate",
      "diff",
      "--from-empty",
      "--to-schema-datamodel",
      schemaPath,
      "--script"
    ],
    {
      cwd: root,
      encoding: "utf8"
    }
  );

  assert.equal(generated.status, 0, generated.stderr);
  assert.equal(generated.stdout.replace(/\n+$/, "\n"), sql.replace(/\n+$/, "\n"));
});

test("database verification refuses retained, remote, or ambiguously authorized databases", () => {
  const attempts = [
    {
      env: {
        MIGRATION_VERIFY_RUN: "1",
        DATABASE_URL: "mysql://local:local@127.0.0.1:3306/teamchat_demo"
      },
      message: /local MySQL database named tm3_migration_verify/
    },
    {
      env: {
        MIGRATION_VERIFY_RUN: "1",
        DATABASE_URL: "mysql://local:local@example.com:3306/tm3_migration_verify"
      },
      message: /local MySQL database named tm3_migration_verify/
    },
    {
      env: {
        MIGRATION_VERIFY_RUN: "",
        DATABASE_URL: "mysql://local:local@127.0.0.1:3306/tm3_migration_verify"
      },
      message: /MIGRATION_VERIFY_RUN=1 is required/
    }
  ];

  for (const attempt of attempts) {
    const result = spawnSync("bash", [databaseVerifierPath], {
      cwd: root,
      env: {
        ...process.env,
        ...attempt.env
      },
      encoding: "utf8"
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, attempt.message);
  }
});
