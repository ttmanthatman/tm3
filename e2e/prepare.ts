import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { E2E_ADMIN, E2E_CHANNELS, E2E_PERF } from "./seed-data.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const databaseUrl = process.env.DATABASE_URL;

if (process.env.E2E_TEST_RUN !== "1" || process.env.NODE_ENV !== "test") {
  throw new Error("Refusing to reset a database outside an explicit E2E test run.");
}
if (!databaseUrl) {
  throw new Error("E2E_DATABASE_URL is required.");
}

const parsedDatabaseUrl = new URL(databaseUrl);
const databaseName = decodeURIComponent(parsedDatabaseUrl.pathname.replace(/^\//, ""));
const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);

if (parsedDatabaseUrl.protocol !== "mysql:" || !localHosts.has(parsedDatabaseUrl.hostname) || databaseName !== "tm3_e2e") {
  throw new Error("E2E database must be a local MySQL database named tm3_e2e.");
}

const prismaCli = path.join(root, "node_modules", "prisma", "build", "index.js");
const schemaResult = spawnSync(
  process.execPath,
  [prismaCli, "db", "push", "--force-reset", "--accept-data-loss", "--skip-generate"],
  {
    cwd: root,
    env: process.env,
    stdio: "inherit"
  }
);

if (schemaResult.status !== 0) {
  throw new Error(`Prisma schema reset failed with exit code ${schemaResult.status ?? "unknown"}.`);
}

const prisma = new PrismaClient();

try {
  const passwordHash = await bcrypt.hash(E2E_ADMIN.password, 4);
  const admin = await prisma.account.create({
    data: {
      username: E2E_ADMIN.username,
      displayName: E2E_ADMIN.displayName,
      passwordHash,
      role: "admin",
      actor: {
        create: {
          kind: "human",
          username: E2E_ADMIN.username,
          displayName: E2E_ADMIN.displayName
        }
      }
    },
    include: { actor: true }
  });
  if (!admin.actor) throw new Error("E2E admin actor was not created.");
  await prisma.channel.createMany({
    data: [
      {
        name: E2E_CHANNELS.default,
        description: "浏览器冒烟测试默认频道",
        icon: "#",
        isDefault: true
      },
      {
        name: E2E_CHANNELS.secondary,
        description: "浏览器冒烟测试切换频道",
        icon: "#"
      }
    ]
  });
  const perfChannel = await prisma.channel.create({
    data: {
      name: E2E_PERF.channel,
      description: "性能基线测试频道",
      icon: "#"
    }
  });
  const perfBaseTime = Date.now() - E2E_PERF.messageCount * 60_000;
  await prisma.message.createMany({
    data: Array.from({ length: E2E_PERF.messageCount }, (_, index) => ({
      channelId: perfChannel.id,
      senderActorId: admin.actor.id,
      // 每 3 条带一个不同的链接，用于观察链接预览预取行为；不同 URL 避免客户端去重掩盖请求数。
      content: `${E2E_PERF.messagePrefix} #${index + 1}${index % 3 === 0 ? ` https://example.com/perf-${index}` : ""}`,
      createdAt: new Date(perfBaseTime + index * 60_000)
    }))
  });
  console.log("E2E database reset and seeded.");
} finally {
  await prisma.$disconnect();
}
