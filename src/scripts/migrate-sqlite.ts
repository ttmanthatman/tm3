import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import { PrismaClient, type ChannelRole, type MessageType } from "@prisma/client";

const prisma = new PrismaClient();
const oldDbPath = process.env.OLD_SQLITE_PATH || process.argv[2] || path.resolve("legacy/database.sqlite");
const oldRoot = process.env.OLD_TEAM_CHAT_ROOT || path.dirname(oldDbPath);
const storageRoot = process.env.STORAGE_ROOT || path.resolve("storage");

function copyDir(name: string) {
  const src = path.join(oldRoot, name);
  const dest = path.join(storageRoot, name);
  fs.mkdirSync(dest, { recursive: true });
  if (!fs.existsSync(src)) return;
  for (const file of fs.readdirSync(src)) {
    const from = path.join(src, file);
    const to = path.join(dest, file);
    if (fs.statSync(from).isFile() && !fs.existsSync(to)) fs.copyFileSync(from, to);
  }
}

function normalizeDate(value: unknown) {
  const raw = String(value || "").trim();
  const d = raw ? new Date(raw.includes("T") ? raw : raw.replace(" ", "T") + "Z") : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

async function main() {
  if (!fs.existsSync(oldDbPath)) throw new Error(`SQLite database not found: ${oldDbPath}`);
  copyDir("uploads");
  copyDir("avatars");
  copyDir("backgrounds");

  const old = new Database(oldDbPath, { readonly: true, fileMustExist: true });
  old.pragma("query_only = ON");

  const userRows = old.prepare("SELECT * FROM users ORDER BY id").all() as any[];
  const channelRows = old.prepare("SELECT * FROM channels ORDER BY id").all() as any[];
  const memberRows = old.prepare("SELECT * FROM channel_members ORDER BY id").all() as any[];
  const messageRows = old.prepare("SELECT * FROM messages ORDER BY id").all() as any[];
  const settingRows = old.prepare("SELECT * FROM settings ORDER BY key").all() as any[];
  const pushRows = old.prepare("SELECT * FROM push_subscriptions ORDER BY id").all() as any[];

  await prisma.$transaction(async (tx) => {
    for (const row of userRows) {
      await tx.account.upsert({
        where: { id: row.id },
        update: {
          username: row.username,
          passwordHash: row.password,
          displayName: row.nickname || row.username,
          avatarPath: row.avatar || null,
          role: row.is_admin ? "admin" : "user",
          lastLoginAt: row.last_login_at ? normalizeDate(row.last_login_at) : null,
          createdAt: normalizeDate(row.created_at)
        },
        create: {
          id: row.id,
          username: row.username,
          passwordHash: row.password || (await bcrypt.hash(cryptoRandomPassword(), 12)),
          displayName: row.nickname || row.username,
          avatarPath: row.avatar || null,
          role: row.is_admin ? "admin" : "user",
          lastLoginAt: row.last_login_at ? normalizeDate(row.last_login_at) : null,
          createdAt: normalizeDate(row.created_at),
          actor: {
            create: {
              id: row.id,
              kind: "human",
              username: row.username,
              displayName: row.nickname || row.username,
              avatarPath: row.avatar || null,
              createdAt: normalizeDate(row.created_at)
            }
          }
        }
      });
      await tx.actor.upsert({
        where: { accountId: row.id },
        update: {
          username: row.username,
          displayName: row.nickname || row.username,
          avatarPath: row.avatar || null
        },
        create: {
          id: row.id,
          kind: "human",
          accountId: row.id,
          username: row.username,
          displayName: row.nickname || row.username,
          avatarPath: row.avatar || null,
          createdAt: normalizeDate(row.created_at)
        }
      });
    }

    for (const row of channelRows) {
      await tx.channel.upsert({
        where: { id: row.id },
        update: {
          name: row.name,
          description: row.description || "",
          isPrivate: !!row.is_private,
          isDefault: !!row.is_default,
          createdAt: normalizeDate(row.created_at)
        },
        create: {
          id: row.id,
          name: row.name,
          description: row.description || "",
          isPrivate: !!row.is_private,
          isDefault: !!row.is_default,
          createdAt: normalizeDate(row.created_at)
        }
      });
    }

    for (const row of memberRows) {
      await tx.channelMember.upsert({
        where: { channelId_accountId: { channelId: row.channel_id, accountId: row.user_id } },
        update: { role: normalizeRole(row.role) },
        create: { channelId: row.channel_id, accountId: row.user_id, role: normalizeRole(row.role), createdAt: normalizeDate(row.created_at) }
      });
    }

    for (const row of messageRows) {
      const type = normalizeMessageType(row.type);
      const content = String(row.content || "");
      const isChain = content.startsWith("[CHAIN]");
      let payload: unknown = undefined;
      let finalType: MessageType = type;
      let finalContent = content;
      let chainRootId: number | null = null;
      let chainVersion: number | null = null;
      if (isChain) {
        finalType = "chain";
        payload = legacyChainPayload(content, row.username);
        finalContent = (payload as any).topic || "接龙";
        chainRootId = row.id;
        chainVersion = 1;
      }
      await tx.message.upsert({
        where: { id: row.id },
        update: {},
        create: {
          id: row.id,
          channelId: row.channel_id || 1,
          senderActorId: row.user_id,
          content: finalContent,
          type: finalType,
          payload: payload as object | undefined,
          fileName: row.file_name || null,
          filePath: row.file_path || null,
          fileSize: row.file_size || null,
          replyToId: row.reply_to || null,
          chainRootId,
          chainVersion,
          createdAt: normalizeDate(row.created_at)
        }
      });
    }

    for (const row of settingRows) {
      await tx.setting.upsert({
        where: { key: row.key },
        update: { value: String(row.value || "") },
        create: { key: row.key, value: String(row.value || "") }
      });
    }

    const notice = settingRows.find((row) => row.key === "pinned_notice");
    const noticeEnabled = settingRows.find((row) => row.key === "pinned_notice_enabled");
    if (notice?.value && String(noticeEnabled?.value || "0") === "1") {
      const channel = await tx.channel.findFirst({ where: { isDefault: true } });
      if (channel) {
        await tx.pinnedItem.create({
          data: { channelId: channel.id, kind: "notice", content: String(notice.value), active: true }
        });
      }
    }

    for (const row of pushRows) {
      await tx.pushSubscription.upsert({
        where: { endpoint: row.endpoint },
        update: { accountId: row.user_id, keysP256dh: row.keys_p256dh, keysAuth: row.keys_auth },
        create: { accountId: row.user_id, endpoint: row.endpoint, keysP256dh: row.keys_p256dh, keysAuth: row.keys_auth, createdAt: normalizeDate(row.created_at) }
      });
    }
  });

  old.close();
  await prisma.$executeRawUnsafe("SET @max_actor := (SELECT COALESCE(MAX(id), 0) FROM actors)");
  console.log(`Migrated ${userRows.length} users, ${channelRows.length} channels, ${messageRows.length} messages.`);
}

function normalizeRole(role: string): ChannelRole {
  if (role === "owner" || role === "admin" || role === "member" || role === "viewer") return role;
  return "member";
}

function normalizeMessageType(type: string): MessageType {
  if (type === "text" || type === "image" || type === "file") return type;
  return "text";
}

function legacyChainPayload(content: string, senderName: string) {
  try {
    const raw = JSON.parse(content.slice(7));
    const participants = Array.isArray(raw.participants)
      ? raw.participants.map((p: any) => ({ actorId: 0, name: p.name || p.username || senderName, text: p.text || "", at: new Date().toISOString() }))
      : [];
    return { topic: raw.topic || "接龙", participants };
  } catch {
    return { topic: "接龙", participants: [] };
  }
}

function cryptoRandomPassword() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
