import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Prisma, type Account, type Actor, type Message, type PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { AdminAttachmentDTO, AdminBackupDTO, AdminMessageDTO } from "../../shared/types.js";
import { APP_VERSION } from "../../shared/release.js";
import { AI_RELATED_VERSES_KIND } from "../aiSettings.js";
import { cleanBiblePreferences, biblePreferencesJson } from "../biblePreferences.js";
import { applyFileResponseHeaders } from "../fileResponses.js";
import { compressImageFile, displayWebpFileName, isImageFileName } from "../imageProcessing.js";
import { serializePinnedBody, pinnedBodyUploadFilePaths } from "../pinnedBody.js";
import { stripMarkdownSyntax } from "../textUtils.js";
import { isZipArchive, unzipArchive, zipArchive, type ZipArchiveEntry } from "../zipArchive.js";
import { AVATAR_DIR, BACKUP_DIR, BG_DIR, ROOT, STORAGE_ROOT, UPLOAD_DIR, safeUnlink, safeUnlinkMusicScore, storageFilePath } from "../storageDirs.js";
import { THEMES } from "./appearance.js";

// 导入的 ZIP 包含消息附件和头像，放宽单文件上限（全局 multipart 默认 80MB）。
const IMPORT_ARCHIVE_MAX_BYTES = 512 * 1024 * 1024;

type AdminDataSocketEmitter = {
  emit(event: string, payload: unknown): unknown;
  to(room: string): { emit(event: string, payload: unknown): unknown };
};

type AdminDataAppearance = {
  appIconPath: string | null;
  wallpaperPath: string | null;
  loginBackgroundPath: string | null;
  loginIconPath: string | null;
};

type AccountWithActor = Account & { actor: Actor | null };

export type AdminDataRouteDependencies = {
  prisma: PrismaClient;
  requireAdmin: preHandlerHookHandler;
  io: AdminDataSocketEmitter;
  authDto(account: AccountWithActor): unknown;
  refreshAccountConnections(account: AccountWithActor): void;
  cleanChannelIcon(input: unknown): string;
  deleteMessages(messages: Array<Pick<Message, "id" | "channelId" | "filePath">>): Promise<unknown>;
  activePinnedUsesUpload(fileName: string): Promise<boolean>;
  uploadIsStillReferenced(fileName: string): Promise<boolean>;
  emitPinnedRefresh(channelIds: Set<number>): Promise<void>;
  appearanceDto(): Promise<AdminDataAppearance>;
  setSetting(key: string, value: string): Promise<void>;
};

export function registerAdminDataRoutes(app: FastifyInstance, deps: AdminDataRouteDependencies) {
  const {
    prisma,
    requireAdmin,
    io,
    authDto,
    refreshAccountConnections,
    cleanChannelIcon,
    deleteMessages,
    activePinnedUsesUpload,
    uploadIsStillReferenced,
    emitPinnedRefresh,
    appearanceDto,
    setSetting
  } = deps;

  function zipDownload(reply: FastifyReply, fileName: string, entries: ZipArchiveEntry[]) {
    reply.header("Content-Type", "application/zip");
    reply.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    return reply.send(zipArchive(entries));
  }

  function badImportRequest(message: string): never {
    const error = new Error(message) as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }

  // 导入兼容旧版纯 JSON 导出和当前 ZIP 导出包；ZIP 内按文件名定位数据 JSON。
  async function readDataImportUpload(request: FastifyRequest, jsonFileName: string): Promise<{ payload: any; entries: ZipArchiveEntry[] }> {
    const file = await request.file({ limits: { fileSize: IMPORT_ARCHIVE_MAX_BYTES, files: 1 } });
    if (!file) badImportRequest("缺少导入文件");
    const chunks: Buffer[] = [];
    for await (const chunk of file.file) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (file.file.truncated) badImportRequest("导入文件超过大小限制");
    const buffer = Buffer.concat(chunks);
    if (!isZipArchive(buffer)) {
      try {
        return { payload: JSON.parse(buffer.toString("utf8")) as any, entries: [] };
      } catch {
        badImportRequest("导入文件不是有效 JSON 或 ZIP");
      }
    }
    let entries: ZipArchiveEntry[];
    try {
      entries = unzipArchive(buffer);
    } catch {
      badImportRequest("导入文件不是有效的 ZIP 包");
    }
    const jsonEntry = entries.find((entry) => entry.name.split("/").pop() === jsonFileName);
    if (!jsonEntry) badImportRequest(`导入包中缺少 ${jsonFileName}`);
    try {
      return { payload: JSON.parse(jsonEntry.data.toString("utf8")) as any, entries };
    } catch {
      badImportRequest(`导入包中的 ${jsonFileName} 不是有效 JSON`);
    }
  }

  // 把导出包中指定前缀（uploads/、avatars/）的文件还原到对应存储目录。
  function restoreExportFiles(entries: ZipArchiveEntry[], prefix: string, targetDir: string) {
    let restored = 0;
    for (const entry of entries) {
      if (!entry.name.startsWith(prefix)) continue;
      const fileName = path.basename(entry.name);
      if (!fileName) continue;
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(path.join(targetDir, fileName), entry.data);
      restored += 1;
    }
    return restored;
  }

  function parseDate(value: unknown, fallback = new Date()) {
    const date = value ? new Date(String(value)) : fallback;
    return Number.isNaN(date.getTime()) ? fallback : date;
  }

  function zipSafeName(name: string) {
    return name.replace(/[\\/:*?"<>|]+/g, "_").replace(/\.+/g, ".").slice(0, 180) || "file";
  }

  function backupFileUrl(fileName: string) {
    return `/api/admin/backups/${encodeURIComponent(path.basename(fileName))}`;
  }

  function isManagedBackupFileName(fileName: string) {
    return /^liao-full-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.zip$/.test(path.basename(fileName));
  }

  function backupFilePath(fileName: string) {
    const safeName = path.basename(fileName);
    if (!isManagedBackupFileName(safeName)) return "";
    return path.join(BACKUP_DIR, safeName);
  }

  function listAdminBackups(): AdminBackupDTO[] {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs
      .readdirSync(BACKUP_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile() && isManagedBackupFileName(entry.name))
      .map((entry) => {
        const filePath = path.join(BACKUP_DIR, entry.name);
        const stat = fs.statSync(filePath);
        return {
          fileName: entry.name,
          size: stat.size,
          createdAt: stat.birthtime.toISOString(),
          url: backupFileUrl(entry.name)
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  function shouldSkipBackupEntry(relativePath: string, isDirectory: boolean) {
    const parts = relativePath.split(path.sep).filter(Boolean);
    if (!parts.length) return false;
    const first = parts[0];
    if ([".git", "node_modules", ".playwright-cli", ".codebase-memory", "coverage"].includes(first)) return true;
    if (first === "storage" && parts[1] === "backups") return true;
    if (isDirectory && first === ".vite") return true;
    return relativePath.endsWith(".tmp") || relativePath.endsWith(".log");
  }

  function collectDirectoryBackupEntries(rootDir: string, zipPrefix: string, skipEntry: (relativePath: string, isDirectory: boolean) => boolean) {
    const entries: Array<{ name: string; data: Buffer; date?: Date }> = [];
    if (!fs.existsSync(rootDir)) return entries;
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(rootDir, fullPath);
        if (!relativePath || skipEntry(relativePath, entry.isDirectory())) continue;
        if (entry.isDirectory()) {
          walk(fullPath);
          continue;
        }
        if (!entry.isFile()) continue;
        const stat = fs.statSync(fullPath);
        entries.push({
          name: `${zipPrefix}/${relativePath.split(path.sep).map(zipSafeName).join("/")}`,
          data: fs.readFileSync(fullPath),
          date: stat.mtime
        });
      }
    };
    walk(rootDir);
    return entries;
  }

  function collectBackupProgramEntries(rootDir = ROOT, hiddenReceptionUploads = new Set<string>()) {
    return collectDirectoryBackupEntries(rootDir, "program", (relativePath, isDirectory) => {
      if (shouldSkipBackupEntry(relativePath, isDirectory)) return true;
      const parts = relativePath.split(path.sep).filter(Boolean);
      return !isDirectory && parts[0] === "storage" && parts[1] === "uploads" && hiddenReceptionUploads.has(parts[2] || "");
    });
  }

  function isPathInside(childPath: string, parentPath: string) {
    const relative = path.relative(parentPath, childPath);
    return !relative || (!relative.startsWith("..") && !path.isAbsolute(relative));
  }

  function collectExternalStorageEntries(hiddenReceptionUploads = new Set<string>()) {
    if (STORAGE_ROOT === path.join(ROOT, "storage") || isPathInside(STORAGE_ROOT, ROOT)) return [];
    return collectDirectoryBackupEntries(STORAGE_ROOT, "storage", (relativePath, isDirectory) => {
      const parts = relativePath.split(path.sep).filter(Boolean);
      if (parts[0] === "backups") return true;
      if (!isDirectory && parts[0] === "uploads" && hiddenReceptionUploads.has(parts[1] || "")) return true;
      return isDirectory ? false : relativePath.endsWith(".tmp") || relativePath.endsWith(".log");
    });
  }

  function sqliteDatabasePath() {
    const databaseUrl = process.env.DATABASE_URL || "";
    if (!databaseUrl.startsWith("file:")) return "";
    const rawPath = databaseUrl.slice("file:".length).split("?")[0];
    if (!rawPath || rawPath === ":memory:") return "";
    return path.resolve(ROOT, rawPath);
  }

  function collectExternalDatabaseEntry(existingEntries: Array<{ name: string }>) {
    const dbPath = sqliteDatabasePath();
    if (!dbPath || !fs.existsSync(dbPath) || isPathInside(dbPath, ROOT) || isPathInside(dbPath, STORAGE_ROOT)) return [];
    const stat = fs.statSync(dbPath);
    const name = `database/${zipSafeName(path.basename(dbPath))}`;
    if (existingEntries.some((entry) => entry.name === name)) return [];
    return [{ name, data: fs.readFileSync(dbPath), date: stat.mtime }];
  }

  async function createFullBackup(auth: { username: string }) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const createdAt = new Date();
    const stamp = createdAt.toISOString().replace(/[:.]/g, "-");
    const fileName = `liao-full-backup-${stamp}.zip`;
    const filePath = path.join(BACKUP_DIR, fileName);
    const [chatData, userData, appearance, attachments, receptionFiles] = await Promise.all([
      chatExportPayload(),
      usersExportPayload(),
      appearanceDto(),
      adminAttachmentList(),
      prisma.message.findMany({ where: { filePath: { not: null }, channel: { kind: "reception" } }, select: { filePath: true } })
    ]);
    const hiddenReceptionUploads = new Set(receptionFiles.map((message) => path.basename(message.filePath || "")).filter(Boolean));
    const entries = [...collectBackupProgramEntries(ROOT, hiddenReceptionUploads), ...collectExternalStorageEntries(hiddenReceptionUploads)];
    entries.push(...collectExternalDatabaseEntry(entries));
    const manifest = {
      kind: "liao-full-backup",
      version: 1,
      appVersion: APP_VERSION,
      createdAt: createdAt.toISOString(),
      createdBy: auth.username,
      root: ROOT,
      storageRoot: STORAGE_ROOT,
      included: {
        programFiles: entries.length,
        attachments: attachments.length,
        chatMessages: Array.isArray((chatData as { messages?: unknown[] }).messages) ? (chatData as { messages: unknown[] }).messages.length : 0,
        accounts: Array.isArray((userData as { accounts?: unknown[] }).accounts) ? (userData as { accounts: unknown[] }).accounts.length : 0
      },
      notes: [
        "program/ contains the application files and storage data except generated backups, dependency folders, git metadata, and transient logs.",
        "data/chat.json and data/users.json are portable exports from the admin data tools."
      ]
    };
    entries.unshift(
      { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8"), date: createdAt },
      { name: "data/chat.json", data: Buffer.from(JSON.stringify(chatData, null, 2), "utf8"), date: createdAt },
      { name: "data/users.json", data: Buffer.from(JSON.stringify(userData, null, 2), "utf8"), date: createdAt },
      { name: "data/appearance.json", data: Buffer.from(JSON.stringify(appearance, null, 2), "utf8"), date: createdAt }
    );
    fs.writeFileSync(filePath, zipArchive(entries));
    return { fileName, filePath };
  }

  function attachmentId(kind: AdminAttachmentDTO["kind"], fileName: string) {
    return `${kind}:${path.basename(fileName)}`;
  }

  function adminAttachmentFileUrl(kind: AdminAttachmentDTO["kind"], fileName: string) {
    return `/api/admin/attachments/file/${kind}/${encodeURIComponent(path.basename(fileName))}`;
  }

  function parseAttachmentId(id: string) {
    const [kind, ...rest] = String(id || "").split(":");
    const fileName = path.basename(rest.join(":"));
    if ((kind === "upload" || kind === "avatar" || kind === "background") && fileName) {
      return { kind: kind as AdminAttachmentDTO["kind"], fileName };
    }
    return null;
  }

  function listStorageFiles(dir: string) {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const filePath = path.join(dir, entry.name);
        const stat = fs.statSync(filePath);
        return { name: entry.name, size: stat.size, createdAt: stat.birthtime };
      });
  }

  function messagePreview(message: Pick<Message, "content" | "fileName" | "type">) {
    const raw = message.content || message.fileName || (message.type === "prayer" ? "[代祷]" : message.type === "sermon_request" ? "[申请演讲]" : message.type === "bible_session" ? "[圣经]" : message.type === "image" ? "[图片]" : message.type === "file" ? "[文件]" : "");
    return stripMarkdownSyntax(raw.replace(/<[^>]*>/g, " ")).slice(0, 120);
  }

  async function detachMessageAttachments(messages: Array<Pick<Message, "id" | "channelId" | "filePath">>) {
    const ids = messages.map((message) => message.id);
    const channelIds = [...new Set(messages.map((message) => message.channelId))];
    const scorePages = ids.length
      ? await prisma.musicScorePage.findMany({ where: { score: { trackId: { in: ids } } }, select: { filePath: true } })
      : [];
    if (ids.length) {
      await prisma.$transaction([
        prisma.voiceListen.deleteMany({ where: { messageId: { in: ids } } }),
        prisma.prayerAction.deleteMany({ where: { messageId: { in: ids } } }),
        prisma.musicScorePage.deleteMany({ where: { score: { trackId: { in: ids } } } }),
        prisma.musicScore.deleteMany({ where: { trackId: { in: ids } } }),
        prisma.message.updateMany({
          where: { id: { in: ids } },
          data: { type: "text", content: "[附件已由管理员删除]", payload: Prisma.JsonNull, fileName: null, filePath: null, fileSize: null }
        })
      ]);
    }
    for (const message of messages) {
      if (message.filePath && !(await uploadIsStillReferenced(message.filePath))) safeUnlink("upload", message.filePath);
    }
    for (const page of scorePages) safeUnlinkMusicScore(page.filePath);
    for (const channelId of channelIds) io.to(`ch:${channelId}`).emit("messages:refresh", { channelId });
    return ids.length;
  }

  async function adminAttachmentList(): Promise<AdminAttachmentDTO[]> {
    const [messages, receptionMessages, accounts, channels, pinnedItems, appearance] = await Promise.all([
      prisma.message.findMany({
        where: { filePath: { not: null }, channel: { kind: { not: "reception" } } },
        include: { channel: true, sender: true },
        orderBy: { id: "desc" }
      }),
      prisma.message.findMany({ where: { filePath: { not: null }, channel: { kind: "reception" } }, select: { filePath: true } }),
      prisma.account.findMany({ where: { isGuest: false }, select: { displayName: true, avatarPath: true } }),
      prisma.channel.findMany({ where: { kind: { not: "reception" } }, select: { name: true, icon: true } }),
      prisma.pinnedItem.findMany({ where: { active: true, channel: { kind: { not: "reception" } } }, include: { channel: true }, orderBy: { id: "desc" } }),
      appearanceDto()
    ]);

    const rows = new Map<string, AdminAttachmentDTO>();
    const hiddenReceptionUploads = new Set(receptionMessages.map((message) => path.basename(message.filePath || "")).filter(Boolean));
    for (const file of listStorageFiles(UPLOAD_DIR)) {
      if (hiddenReceptionUploads.has(file.name)) continue;
      rows.set(attachmentId("upload", file.name), {
        id: attachmentId("upload", file.name),
        kind: "upload",
        fileName: file.name,
        label: file.name,
        size: file.size,
        createdAt: file.createdAt.toISOString(),
        url: adminAttachmentFileUrl("upload", file.name),
        usage: [],
        exists: true
      });
    }
    for (const message of messages) {
      if (!message.filePath) continue;
      const fileName = path.basename(message.filePath);
      const id = attachmentId("upload", fileName);
      const current = rows.get(id);
      rows.set(id, {
        id,
        kind: "upload",
        fileName,
        label: message.fileName || fileName,
        size: current?.size || message.fileSize || 0,
        createdAt: message.createdAt.toISOString(),
        url: current?.exists ? current.url : undefined,
        messageId: message.id,
        channelName: message.channel.name,
        ownerName: message.sender.displayName,
        usage: [...new Set([...(current?.usage || []), `消息 #${message.id}`, message.channel.name, message.sender.displayName])],
        exists: current?.exists || false
      });
    }
    for (const pin of pinnedItems) {
      const body = serializePinnedBody(pin.body, pin.content);
      for (const block of body.blocks) {
        if (block.type !== "image" && block.type !== "file") continue;
        const fileName = path.basename(block.filePath);
        const id = attachmentId("upload", fileName);
        const current = rows.get(id);
        const usage = [...(current?.usage || []), `置顶 · ${pin.channel.name}`];
        rows.set(id, {
          id,
          kind: "upload",
          fileName,
          label: current?.label || block.fileName || fileName,
          size: current?.size || block.fileSize || 0,
          createdAt: current?.createdAt || pin.createdAt.toISOString(),
          url: current?.exists ? current.url : undefined,
          messageId: current?.messageId,
          channelName: current?.channelName || pin.channel.name,
          ownerName: current?.ownerName,
          usage,
          exists: current?.exists || false
        });
      }
    }

    for (const file of listStorageFiles(AVATAR_DIR)) {
      const usage = accounts.filter((account) => account.avatarPath === file.name).map((account) => `${account.displayName} 头像`);
      rows.set(attachmentId("avatar", file.name), {
        id: attachmentId("avatar", file.name),
        kind: "avatar",
        fileName: file.name,
        label: usage[0] || file.name,
        size: file.size,
        createdAt: file.createdAt.toISOString(),
        url: adminAttachmentFileUrl("avatar", file.name),
        usage,
        exists: true
      });
    }

    const backgroundUsage = new Map<string, string[]>();
    if (appearance.appIconPath) backgroundUsage.set(path.basename(appearance.appIconPath), ["聊天室标签页图标"]);
    if (appearance.wallpaperPath) backgroundUsage.set(path.basename(appearance.wallpaperPath), ["聊天室壁纸"]);
    if (appearance.loginBackgroundPath) backgroundUsage.set(path.basename(appearance.loginBackgroundPath), [...(backgroundUsage.get(path.basename(appearance.loginBackgroundPath)) || []), "登录页背景"]);
    if (appearance.loginIconPath) backgroundUsage.set(path.basename(appearance.loginIconPath), [...(backgroundUsage.get(path.basename(appearance.loginIconPath)) || []), "登录页图标"]);
    for (const channel of channels) {
      if (channel.icon && /\.(jpe?g|png|gif|webp)$/i.test(channel.icon)) {
        const fileName = path.basename(channel.icon);
        backgroundUsage.set(fileName, [...(backgroundUsage.get(fileName) || []), `${channel.name} 频道图标`]);
      }
    }
    for (const file of listStorageFiles(BG_DIR)) {
      const usage = backgroundUsage.get(file.name) || [];
      rows.set(attachmentId("background", file.name), {
        id: attachmentId("background", file.name),
        kind: "background",
        fileName: file.name,
        label: usage[0] || file.name,
        size: file.size,
        createdAt: file.createdAt.toISOString(),
        url: adminAttachmentFileUrl("background", file.name),
        usage,
        exists: true
      });
    }

    return [...rows.values()].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  }

  async function isReceptionUpload(fileName: string) {
    const target = path.basename(fileName);
    if (!target) return false;
    return (await prisma.message.count({ where: { filePath: target, channel: { kind: "reception" } } })) > 0;
  }

  async function deleteAttachmentTargets(targets: Array<{ kind: AdminAttachmentDTO["kind"]; fileName: string }>) {
    let deleted = 0;
    const refreshChannels = new Set<number>();
    let appearanceChanged = false;
    let channelsChanged = false;
    for (const target of targets) {
      const fileName = path.basename(target.fileName);
      if (target.kind === "upload" && (await isReceptionUpload(fileName))) continue;
      const filePath = storageFilePath(target.kind, fileName);
      const existed = fs.existsSync(filePath);
      const keepForPinned = target.kind === "upload" && (await activePinnedUsesUpload(fileName));
      if (target.kind === "upload") {
        const messages = await prisma.message.findMany({ where: { filePath: fileName }, select: { id: true, channelId: true, filePath: true } });
        for (const message of messages) refreshChannels.add(message.channelId);
        if (messages.length) await detachMessageAttachments(messages);
      } else if (target.kind === "avatar") {
        await prisma.account.updateMany({ where: { avatarPath: fileName }, data: { avatarPath: null } });
        await prisma.actor.updateMany({ where: { avatarPath: fileName }, data: { avatarPath: null } });
      } else {
        const appearance = await appearanceDto();
        if (appearance.wallpaperPath === fileName) {
          await setSetting("wallpaperPath", "");
          appearanceChanged = true;
        }
        if (appearance.appIconPath === fileName) {
          await setSetting("appIconPath", "");
          appearanceChanged = true;
        }
        if (appearance.loginBackgroundPath === fileName) {
          await setSetting("loginBackgroundPath", "");
          appearanceChanged = true;
        }
        if (appearance.loginIconPath === fileName) {
          await setSetting("loginIconPath", "");
          appearanceChanged = true;
        }
        const updated = await prisma.channel.updateMany({ where: { icon: fileName }, data: { icon: "" } });
        channelsChanged = channelsChanged || updated.count > 0;
      }
      if (existed && !keepForPinned) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        deleted += 1;
      }
    }
    for (const channelId of refreshChannels) io.to(`ch:${channelId}`).emit("messages:refresh", { channelId });
    if (appearanceChanged) io.emit("appearance:updated", await appearanceDto());
    if (channelsChanged) io.emit("channel:updated", { action: "updated" });
    return deleted;
  }

  async function replaceUploadAttachmentReferences(oldFileName: string, newFileName: string, newSize: number) {
    const refreshChannels = new Set<number>();
    const pinChannels = new Set<number>();
    const messages = await prisma.message.findMany({ where: { filePath: oldFileName }, select: { id: true, channelId: true, fileName: true, type: true } });
    for (const message of messages) {
      refreshChannels.add(message.channelId);
      await prisma.message.update({
        where: { id: message.id },
        data: {
          filePath: newFileName,
          fileName: message.type === "image" ? displayWebpFileName(message.fileName || oldFileName) : message.fileName,
          fileSize: newSize
        }
      });
    }

    const pins = await prisma.pinnedItem.findMany({ orderBy: { id: "asc" } });
    for (const pin of pins) {
      const body = serializePinnedBody(pin.body, pin.content);
      let changed = false;
      for (const block of body.blocks) {
        if ((block.type === "image" || block.type === "file") && path.basename(block.filePath) === oldFileName) {
          block.filePath = newFileName;
          block.fileName = block.type === "image" ? displayWebpFileName(block.fileName || oldFileName) : block.fileName;
          block.fileSize = newSize;
          changed = true;
        }
      }
      if (changed) {
        await prisma.pinnedItem.update({ where: { id: pin.id }, data: { body: body as unknown as Prisma.InputJsonValue } });
        pinChannels.add(pin.channelId);
      }
    }

    for (const channelId of refreshChannels) io.to(`ch:${channelId}`).emit("messages:refresh", { channelId });
    await emitPinnedRefresh(pinChannels);
  }

  async function replaceAvatarAttachmentReferences(oldFileName: string, newFileName: string) {
    await prisma.account.updateMany({ where: { avatarPath: oldFileName }, data: { avatarPath: newFileName } });
    await prisma.actor.updateMany({ where: { avatarPath: oldFileName }, data: { avatarPath: newFileName } });
    const accounts = await prisma.account.findMany({ where: { avatarPath: newFileName }, include: { actor: true } });
    for (const account of accounts) refreshAccountConnections(account);
    io.emit("channel:updated", { action: "updated" });
  }

  async function replaceBackgroundAttachmentReferences(oldFileName: string, newFileName: string) {
    const appearance = await appearanceDto();
    let appearanceChanged = false;
    if (appearance.wallpaperPath === oldFileName) {
      await setSetting("wallpaperPath", newFileName);
      appearanceChanged = true;
    }
    if (appearance.appIconPath === oldFileName) {
      await setSetting("appIconPath", newFileName);
      appearanceChanged = true;
    }
    if (appearance.loginBackgroundPath === oldFileName) {
      await setSetting("loginBackgroundPath", newFileName);
      appearanceChanged = true;
    }
    if (appearance.loginIconPath === oldFileName) {
      await setSetting("loginIconPath", newFileName);
      appearanceChanged = true;
    }
    const updated = await prisma.channel.updateMany({ where: { icon: oldFileName }, data: { icon: newFileName } });
    if (appearanceChanged) io.emit("appearance:updated", await appearanceDto());
    if (updated.count > 0) io.emit("channel:updated", { action: "updated" });
  }

  async function compressAttachmentTarget(target: { kind: AdminAttachmentDTO["kind"]; fileName: string }) {
    const fileName = path.basename(target.fileName);
    if (target.kind === "upload" && (await isReceptionUpload(fileName))) {
      return { id: attachmentId(target.kind, fileName), status: "skipped" as const, reason: "会客厅内容不向管理员开放" };
    }
    if (!isImageFileName(fileName)) return { id: attachmentId(target.kind, fileName), status: "skipped" as const, reason: "不是图片文件" };
    const filePath = storageFilePath(target.kind, fileName);
    if (!fs.existsSync(filePath)) return { id: attachmentId(target.kind, fileName), status: "skipped" as const, reason: "文件不存在" };
    const shortName = target.kind === "background" && (await prisma.channel.count({ where: { icon: fileName } })) > 0;
    const compressed = await compressImageFile(filePath, path.dirname(filePath), { shortName });
    if (!compressed) return { id: attachmentId(target.kind, fileName), status: "skipped" as const, reason: "压缩后没有更小" };

    fs.unlinkSync(filePath);
    if (target.kind === "upload") {
      await replaceUploadAttachmentReferences(fileName, compressed.fileName, compressed.size);
    } else if (target.kind === "avatar") {
      await replaceAvatarAttachmentReferences(fileName, compressed.fileName);
    } else {
      await replaceBackgroundAttachmentReferences(fileName, compressed.fileName);
    }
    return {
      id: attachmentId(target.kind, fileName),
      status: "compressed" as const,
      fileName: compressed.fileName,
      size: compressed.size,
      originalSize: compressed.originalSize,
      savedBytes: compressed.savedBytes
    };
  }

  async function chatExportPayload() {
    const channels = await prisma.channel.findMany({ where: { kind: { not: "reception" } }, orderBy: { id: "asc" } });
    const channelIds = channels.map((channel) => channel.id);
    const [channelMembers, messages, pinnedItems, voiceListens, prayerActions, messageAiSuggestions] = await Promise.all([
      prisma.channelMember.findMany({ where: { channelId: { in: channelIds } }, orderBy: { id: "asc" } }),
      prisma.message.findMany({ where: { channelId: { in: channelIds } }, orderBy: { id: "asc" } }),
      prisma.pinnedItem.findMany({ where: { channelId: { in: channelIds } }, orderBy: { id: "asc" } }),
      prisma.voiceListen.findMany({ where: { message: { channelId: { in: channelIds } } }, orderBy: { id: "asc" } }),
      prisma.prayerAction.findMany({ where: { message: { channelId: { in: channelIds } } }, orderBy: { id: "asc" } }),
      prisma.messageAiSuggestion.findMany({ where: { message: { channelId: { in: channelIds } } }, orderBy: { id: "asc" } })
    ]);
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      channels,
      channelMembers,
      messages,
      pinnedItems,
      voiceListens,
      prayerActions,
      messageAiSuggestions
    };
  }

  async function usersExportPayload() {
    const accounts = await prisma.account.findMany({ where: { isGuest: false }, include: { actor: true }, orderBy: { id: "asc" } });
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      accounts: accounts.map((account) => ({
        id: account.id,
        username: account.username,
        passwordHash: account.passwordHash,
        displayName: account.displayName,
        avatarPath: account.avatarPath,
        role: account.role,
        canPinMessages: account.canPinMessages,
        theme: account.theme,
        biblePreferences: cleanBiblePreferences(account.biblePreferences),
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
        actor: account.actor
      }))
    };
  }

  // 聊天导出包：chat.json + 消息与置顶内容引用的附件文件。
  async function chatExportZipEntries() {
    const payload = await chatExportPayload();
    const entries: ZipArchiveEntry[] = [{ name: "chat.json", data: Buffer.from(JSON.stringify(payload, null, 2), "utf8") }];
    const fileNames = new Set<string>();
    for (const message of payload.messages) {
      if (message.filePath) fileNames.add(path.basename(message.filePath));
    }
    for (const pin of payload.pinnedItems) {
      for (const fileName of pinnedBodyUploadFilePaths(serializePinnedBody(pin.body, pin.content))) fileNames.add(fileName);
    }
    for (const fileName of fileNames) {
      const filePath = path.join(UPLOAD_DIR, fileName);
      if (fs.existsSync(filePath)) entries.push({ name: `uploads/${fileName}`, data: fs.readFileSync(filePath) });
    }
    return entries;
  }

  // 用户导出包：users.json + 账号和角色引用的头像文件。
  async function usersExportZipEntries() {
    const payload = await usersExportPayload();
    const entries: ZipArchiveEntry[] = [{ name: "users.json", data: Buffer.from(JSON.stringify(payload, null, 2), "utf8") }];
    const avatarNames = new Set<string>();
    for (const account of payload.accounts) {
      if (account.avatarPath) avatarNames.add(path.basename(account.avatarPath));
      if (account.actor?.avatarPath) avatarNames.add(path.basename(account.actor.avatarPath));
    }
    for (const fileName of avatarNames) {
      const filePath = path.join(AVATAR_DIR, fileName);
      if (fs.existsSync(filePath)) entries.push({ name: `avatars/${fileName}`, data: fs.readFileSync(filePath) });
    }
    return entries;
  }

  app.get("/api/admin/export/chat", { preHandler: requireAdmin }, async (_request, reply) => {
    return zipDownload(reply, `team-chat-data-${new Date().toISOString().slice(0, 10)}.zip`, await chatExportZipEntries());
  });

  app.post("/api/admin/import/chat", { preHandler: requireAdmin }, async (request, reply) => {
    const { payload, entries } = await readDataImportUpload(request, "chat.json");
    const channels = Array.isArray(payload.channels) ? payload.channels : [];
    const channelMembers = Array.isArray(payload.channelMembers) ? payload.channelMembers : [];
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const pinnedItems = Array.isArray(payload.pinnedItems) ? payload.pinnedItems : [];
    const voiceListens = Array.isArray(payload.voiceListens) ? payload.voiceListens : [];
    const prayerActions = Array.isArray(payload.prayerActions) ? payload.prayerActions : [];
    const messageAiSuggestions = Array.isArray(payload.messageAiSuggestions) ? payload.messageAiSuggestions : [];
    await prisma.$transaction(async (tx) => {
      for (const channel of channels) {
        await tx.channel.upsert({
          where: { id: Number(channel.id) },
          update: {
            name: String(channel.name || "未命名频道").slice(0, 80),
            description: String(channel.description || "").slice(0, 255),
            icon: cleanChannelIcon(channel.icon),
            isPrivate: !!channel.isPrivate,
            isDefault: !!channel.isDefault,
            directKey: channel.directKey ? String(channel.directKey).slice(0, 120) : null,
            createdAt: parseDate(channel.createdAt),
            updatedAt: parseDate(channel.updatedAt)
          },
          create: {
            id: Number(channel.id) || undefined,
            name: String(channel.name || "未命名频道").slice(0, 80),
            description: String(channel.description || "").slice(0, 255),
            icon: cleanChannelIcon(channel.icon),
            isPrivate: !!channel.isPrivate,
            isDefault: !!channel.isDefault,
            directKey: channel.directKey ? String(channel.directKey).slice(0, 120) : null,
            createdAt: parseDate(channel.createdAt),
            updatedAt: parseDate(channel.updatedAt)
          }
        });
      }
      for (const member of channelMembers) {
        await tx.channelMember.upsert({
          where: { channelId_accountId: { channelId: Number(member.channelId), accountId: Number(member.accountId) } },
          update: { role: member.role || "member" },
          create: { channelId: Number(member.channelId), accountId: Number(member.accountId), role: member.role || "member", createdAt: parseDate(member.createdAt) }
        });
      }
      for (const message of messages) {
        await tx.message.upsert({
          where: { id: Number(message.id) },
          update: {
            channelId: Number(message.channelId),
            senderActorId: Number(message.senderActorId),
            content: message.content || "",
            type: message.type || "text",
            payload: message.payload === null || message.payload === undefined ? Prisma.JsonNull : message.payload,
            fileName: message.fileName || null,
            filePath: message.filePath || null,
            fileSize: message.fileSize === null || message.fileSize === undefined ? null : Number(message.fileSize),
            replyToId: message.replyToId || null,
            chainRootId: message.chainRootId || null,
            chainVersion: message.chainVersion || null,
            createdAt: parseDate(message.createdAt)
          },
          create: {
            id: Number(message.id) || undefined,
            channelId: Number(message.channelId),
            senderActorId: Number(message.senderActorId),
            content: message.content || "",
            type: message.type || "text",
            payload: message.payload === null || message.payload === undefined ? Prisma.JsonNull : message.payload,
            fileName: message.fileName || null,
            filePath: message.filePath || null,
            fileSize: message.fileSize === null || message.fileSize === undefined ? null : Number(message.fileSize),
            replyToId: message.replyToId || null,
            chainRootId: message.chainRootId || null,
            chainVersion: message.chainVersion || null,
            createdAt: parseDate(message.createdAt)
          }
        });
      }
      for (const pin of pinnedItems) {
        await tx.pinnedItem.upsert({
          where: { id: Number(pin.id) },
          update: {
            channelId: Number(pin.channelId),
            kind: pin.kind || "notice",
            title: pin.title || null,
            content: pin.content || null,
            body: pin.body === null || pin.body === undefined ? Prisma.JsonNull : pin.body,
            messageId: pin.messageId || null,
            version: Number(pin.version) || 1,
            active: !!pin.active
          },
          create: {
            id: Number(pin.id) || undefined,
            channelId: Number(pin.channelId),
            kind: pin.kind || "notice",
            title: pin.title || null,
            content: pin.content || null,
            body: pin.body === null || pin.body === undefined ? Prisma.JsonNull : pin.body,
            messageId: pin.messageId || null,
            version: Number(pin.version) || 1,
            active: !!pin.active,
            createdAt: parseDate(pin.createdAt),
            updatedAt: parseDate(pin.updatedAt)
          }
        });
      }
      for (const listen of voiceListens) {
        await tx.voiceListen.upsert({
          where: { messageId_accountId: { messageId: Number(listen.messageId), accountId: Number(listen.accountId) } },
          update: { listenedAt: parseDate(listen.listenedAt) },
          create: { messageId: Number(listen.messageId), accountId: Number(listen.accountId), listenedAt: parseDate(listen.listenedAt) }
        });
      }
      for (const action of prayerActions) {
        const id = Number(action.id) || undefined;
        const data = { messageId: Number(action.messageId), accountId: Number(action.accountId), prayedAt: parseDate(action.prayedAt) };
        if (id) {
          await tx.prayerAction.upsert({ where: { id }, update: data, create: { id, ...data } });
        } else {
          await tx.prayerAction.create({ data });
        }
      }
      for (const suggestion of messageAiSuggestions) {
        const id = Number(suggestion.id) || undefined;
        const data = {
          messageId: Number(suggestion.messageId),
          kind: String(suggestion.kind || AI_RELATED_VERSES_KIND).slice(0, 64),
          status: String(suggestion.status || "success").slice(0, 24),
          promptCommand: String(suggestion.promptCommand || "").slice(0, 4000),
          contextText: String(suggestion.contextText || "").slice(0, 5000),
          responseText: suggestion.responseText ? String(suggestion.responseText).slice(0, 4000) : null,
          references: suggestion.references === null || suggestion.references === undefined ? Prisma.JsonNull : suggestion.references,
          errorText: suggestion.errorText ? String(suggestion.errorText).slice(0, 1000) : null,
          model: suggestion.model ? String(suggestion.model).slice(0, 120) : null,
          baseUrl: suggestion.baseUrl ? String(suggestion.baseUrl).slice(0, 255) : null,
          createdByAccountId: suggestion.createdByAccountId ? Number(suggestion.createdByAccountId) : null,
          createdAt: parseDate(suggestion.createdAt)
        };
        if (id) {
          await tx.messageAiSuggestion.upsert({ where: { id }, update: data, create: { id, ...data } });
        } else {
          await tx.messageAiSuggestion.create({ data });
        }
      }
    });
    const attachments = restoreExportFiles(entries, "uploads/", UPLOAD_DIR);
    return { success: true, imported: { channels: channels.length, messages: messages.length, attachments } };
  });

  app.get("/api/admin/export/users", { preHandler: requireAdmin }, async (_request, reply) => {
    return zipDownload(reply, `liao-users-${new Date().toISOString().slice(0, 10)}.zip`, await usersExportZipEntries());
  });

  app.get("/api/admin/backups", { preHandler: requireAdmin }, async () => {
    return { backups: listAdminBackups() };
  });

  app.post("/api/admin/backups", { preHandler: requireAdmin }, async (request) => {
    const { fileName } = await createFullBackup((request as FastifyRequest & { auth: { username: string } }).auth);
    return { success: true, backup: listAdminBackups().find((backup) => backup.fileName === fileName) };
  });

  app.get("/api/admin/backups/:file", { preHandler: requireAdmin }, async (request, reply) => {
    const fileName = path.basename((request.params as { file: string }).file);
    const filePath = backupFilePath(fileName);
    if (!filePath || !fs.existsSync(filePath)) return reply.code(404).send({ success: false, message: "备份不存在" });
    const stat = fs.statSync(filePath);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Content-Type", "application/zip");
    reply.header("Content-Length", String(stat.size));
    reply.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    return reply.send(fs.createReadStream(filePath));
  });

  app.delete("/api/admin/backups/:file", { preHandler: requireAdmin }, async (request, reply) => {
    const fileName = path.basename((request.params as { file: string }).file);
    const filePath = backupFilePath(fileName);
    if (!filePath || !fs.existsSync(filePath)) return reply.code(404).send({ success: false, message: "备份不存在" });
    fs.unlinkSync(filePath);
    return { success: true, deleted: fileName, backups: listAdminBackups() };
  });

  app.get("/api/admin/messages", { preHandler: requireAdmin }, async (request) => {
    const query = request.query as { channelId?: string; q?: string; limit?: string };
    const channelId = Number(query.channelId || 0);
    const q = String(query.q || "").trim();
    const limit = Math.min(Math.max(Number(query.limit || 80), 1), 200);
    const where: Prisma.MessageWhereInput = {
      channel: { kind: { not: "reception" } },
      ...(channelId ? { channelId } : {}),
      ...(q
        ? {
            OR: [
              { content: { contains: q } },
              { fileName: { contains: q } },
              { sender: { displayName: { contains: q } } },
              { channel: { name: { contains: q } } }
            ]
          }
        : {})
    };
    const messages = await prisma.message.findMany({
      where,
      include: { channel: true, sender: true },
      orderBy: { id: "desc" },
      take: limit
    });
    return {
      messages: messages.map(
        (message): AdminMessageDTO => ({
          id: message.id,
          channelId: message.channelId,
          channelName: message.channel.name,
          senderName: message.sender.displayName,
          type: message.type,
          content: messagePreview(message),
          fileName: message.fileName,
          fileSize: message.fileSize,
          createdAt: message.createdAt.toISOString()
        })
      )
    };
  });

  app.delete("/api/admin/messages/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const message = await prisma.message.findFirst({ where: { id, channel: { kind: { not: "reception" } } }, select: { id: true, channelId: true, filePath: true } });
    if (!message) return reply.code(404).send({ success: false, message: "消息不存在" });
    const deleted = await deleteMessages([message]);
    return { success: true, deleted };
  });

  app.delete("/api/admin/messages", { preHandler: requireAdmin }, async (request, reply) => {
    const query = request.query as { channelId?: string };
    if (request.body !== undefined && (typeof request.body !== "object" || Array.isArray(request.body))) {
      return reply.code(400).send({ success: false, message: "聊天记录参数无效" });
    }
    const body = request.body || {};
    const parsedBody = z.object({ ids: z.array(z.number().int().positive()).max(200).optional() }).strict().safeParse(body);
    if (!parsedBody.success) return reply.code(400).send({ success: false, message: "聊天记录参数无效" });
    const ids = parsedBody.success ? parsedBody.data.ids || [] : [];
    if (ids.length) {
      const messages = await prisma.message.findMany({
        where: { id: { in: ids }, channel: { kind: { not: "reception" } } },
        select: { id: true, channelId: true, filePath: true }
      });
      const deleted = await deleteMessages(messages);
      return { success: true, deleted };
    }
    const channelId = Number(query.channelId || 0);
    const messages = await prisma.message.findMany({
      where: channelId ? { channelId, channel: { kind: { not: "reception" } } } : { channel: { kind: { not: "reception" } } },
      select: { id: true, channelId: true, filePath: true }
    });
    const deleted = await deleteMessages(messages);
    return { success: true, deleted };
  });

  app.get("/api/admin/attachments", { preHandler: requireAdmin }, async () => {
    return { attachments: await adminAttachmentList() };
  });

  app.get("/api/admin/attachments/file/:kind/:file", { preHandler: requireAdmin }, async (request, reply) => {
    const { kind, file } = request.params as { kind: AdminAttachmentDTO["kind"]; file: string };
    const query = request.query as { download?: string };
    if (kind !== "upload" && kind !== "avatar" && kind !== "background") return reply.code(404).send("Not found");
    const fileName = path.basename(file);
    if (kind === "upload" && (await isReceptionUpload(fileName))) return reply.code(404).send("Not found");
    const filePath = storageFilePath(kind, fileName);
    if (!fileName || !fs.existsSync(filePath)) return reply.code(404).send("Not found");
    const stat = fs.statSync(filePath);
    const range = request.headers.range;
    reply.header("Accept-Ranges", "bytes");
    applyFileResponseHeaders(reply, fileName, query.download === "1");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match) {
        const start = match[1] ? Number(match[1]) : 0;
        const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
        if (Number.isFinite(start) && Number.isFinite(end) && start <= end && start < stat.size) {
          reply.code(206);
          reply.header("Content-Range", `bytes ${start}-${end}/${stat.size}`);
          reply.header("Content-Length", String(end - start + 1));
          return reply.send(fs.createReadStream(filePath, { start, end }));
        }
      }
      reply.code(416);
      reply.header("Content-Range", `bytes */${stat.size}`);
      return reply.send();
    }
    reply.header("Content-Length", String(stat.size));
    return reply.send(fs.createReadStream(filePath));
  });

  app.delete("/api/admin/attachments", { preHandler: requireAdmin }, async (request, reply) => {
    const body = z.object({ ids: z.array(z.string()).optional(), all: z.boolean().optional() }).parse(request.body || {});
    const targets = body.all ? (await adminAttachmentList()).map((item) => parseAttachmentId(item.id)).filter(Boolean) : (body.ids || []).map(parseAttachmentId).filter(Boolean);
    if (!targets.length) return reply.code(400).send({ success: false, message: "请选择要删除的附件" });
    const deleted = await deleteAttachmentTargets(targets as Array<{ kind: AdminAttachmentDTO["kind"]; fileName: string }>);
    return { success: true, deleted, requested: targets.length };
  });

  app.post("/api/admin/attachments/compress", { preHandler: requireAdmin }, async (request, reply) => {
    const body = z.object({ ids: z.array(z.string()).min(1).max(50) }).parse(request.body || {});
    const targets = body.ids.map(parseAttachmentId).filter(Boolean) as Array<{ kind: AdminAttachmentDTO["kind"]; fileName: string }>;
    if (!targets.length) return reply.code(400).send({ success: false, message: "请选择要压缩的图片" });
    const results = [];
    for (const target of targets) results.push(await compressAttachmentTarget(target));
    const compressed = results.filter((item) => item.status === "compressed");
    const savedBytes = compressed.reduce((sum, item) => sum + ("savedBytes" in item ? item.savedBytes : 0), 0);
    return {
      success: true,
      compressed: compressed.length,
      skipped: results.length - compressed.length,
      savedBytes,
      results,
      attachments: await adminAttachmentList()
    };
  });

  app.post("/api/admin/import/users", { preHandler: requireAdmin }, async (request) => {
    const auth = (request as FastifyRequest & { auth: { accountId: number } }).auth;
    const { payload, entries } = await readDataImportUpload(request, "users.json");
    const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
    const changedAccountIds = new Set<number>();
    for (const item of accounts) {
      const role = item.role === "admin" ? "admin" : "user";
      const theme = THEMES.has(item.theme) ? item.theme : "wechat";
      const biblePreferences = biblePreferencesJson(item.biblePreferences);
      const passwordHash = String(item.passwordHash || (await bcrypt.hash(crypto.randomUUID(), 12)));
      const account = await prisma.account.upsert({
        where: { username: String(item.username) },
        update: {
          passwordHash,
          displayName: String(item.displayName || item.username).slice(0, 80),
          avatarPath: item.avatarPath || null,
          role,
          canPinMessages: !!item.canPinMessages,
          theme,
          biblePreferences
        },
        create: {
          id: Number(item.id) || undefined,
          username: String(item.username).slice(0, 64),
          passwordHash,
          displayName: String(item.displayName || item.username).slice(0, 80),
          avatarPath: item.avatarPath || null,
          role,
          canPinMessages: !!item.canPinMessages,
          theme,
          biblePreferences,
          createdAt: parseDate(item.createdAt),
          actor: {
            create: {
              id: Number(item.actor?.id) || undefined,
              kind: "human",
              username: String(item.actor?.username || item.username).slice(0, 80),
              displayName: String(item.actor?.displayName || item.displayName || item.username).slice(0, 80),
              avatarPath: item.actor?.avatarPath || item.avatarPath || null,
              status: item.actor?.status || "active",
              createdAt: parseDate(item.actor?.createdAt)
            }
          }
        },
        include: { actor: true }
      });
      changedAccountIds.add(account.id);
      if (account.actor) {
        await prisma.actor.update({
          where: { id: account.actor.id },
          data: {
            displayName: String(item.actor?.displayName || item.displayName || item.username).slice(0, 80),
            avatarPath: item.actor?.avatarPath || item.avatarPath || null,
            status: item.actor?.status || "active"
          }
        });
      }
    }
    const adminCount = await prisma.account.count({ where: { role: "admin" } });
    if (!adminCount) {
      await prisma.account.update({ where: { id: auth.accountId }, data: { role: "admin" } });
      changedAccountIds.add(auth.accountId);
    }
    const changedAccounts = changedAccountIds.size
      ? await prisma.account.findMany({ where: { id: { in: [...changedAccountIds] } }, include: { actor: true } })
      : [];
    changedAccounts.forEach(refreshAccountConnections);
    const avatars = restoreExportFiles(entries, "avatars/", AVATAR_DIR);
    return { success: true, imported: { accounts: accounts.length, avatars } };
  });

  app.get("/api/admin/accounts/:id/attachments/export", { preHandler: requireAdmin }, async (request, reply) => {
    const accountId = Number((request.params as { id: string }).id);
    const account = await prisma.account.findUnique({ where: { id: accountId }, include: { actor: true } });
    if (!account) return reply.code(404).send({ success: false, message: "用户不存在" });
    const messages = await prisma.message.findMany({ where: { sender: { accountId }, filePath: { not: null } }, orderBy: { id: "asc" } });
    const manifest = {
      account: authDto(account),
      exportedAt: new Date().toISOString(),
      files: messages.map((message) => ({ messageId: message.id, fileName: message.fileName, filePath: message.filePath, fileSize: message.fileSize, createdAt: message.createdAt }))
    };
    const entries: Array<{ name: string; data: Buffer; date?: Date }> = [{ name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") }];
    for (const message of messages) {
      if (!message.filePath) continue;
      const filePath = path.join(UPLOAD_DIR, path.basename(message.filePath));
      if (fs.existsSync(filePath)) {
        entries.push({ name: `attachments/${message.id}-${zipSafeName(message.fileName || message.filePath)}`, data: fs.readFileSync(filePath), date: message.createdAt });
      }
    }
    const zip = zipArchive(entries);
    reply.header("Content-Type", "application/zip");
    reply.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`liao-${account.username}-attachments.zip`)}`);
    return reply.send(zip);
  });

  app.delete("/api/admin/accounts/:id/attachments", { preHandler: requireAdmin }, async (request, reply) => {
    const accountId = Number((request.params as { id: string }).id);
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) return reply.code(404).send({ success: false, message: "用户不存在" });
    const messages = await prisma.message.findMany({ where: { sender: { accountId }, filePath: { not: null } }, select: { id: true, channelId: true, filePath: true } });
    const deleted = await detachMessageAttachments(messages);
    return { success: true, deleted };
  });

  return { createFullBackup };
}
