import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { DemoAssetKind, DemoAssetRecord, DemoManifestDTO, DemoModeStatusDTO, DemoSnapshot } from "../../shared/demoMode.js";
import { APP_VERSION } from "../../shared/release.js";
import { assertDemoManifest, assertDemoSnapshot, assertGithubDownloadUrl, DEMO_SAFE_SETTING_KEYS, safeArchiveEntry } from "./bundle.js";

const execFileAsync = promisify(execFile);
const MANIFEST_MAX_BYTES = 1024 * 1024;
const ARCHIVE_ENTRY_LIMIT = 20_000;

type DemoModeState = {
  active: boolean;
  datasetVersion: string | null;
  installedAt: string | null;
  lastResetAt: string | null;
};

type DemoResetGate = { busy: boolean };

type DemoModeServiceOptions = {
  prisma: PrismaClient;
  manifestUrl: string;
  statePath: string;
  cacheDir: string;
  storageDirs: Record<DemoAssetKind, string>;
  gate: DemoResetGate;
  createBackup: (operator: { accountId: number; username: string }) => Promise<void>;
  afterReset: (operatorAccountId: number, datasetVersion: string) => Promise<void> | void;
  fetchImpl?: typeof fetch;
  log?: (message: string, details?: unknown) => void;
};

const EMPTY_STATE: DemoModeState = {
  active: false,
  datasetVersion: null,
  installedAt: null,
  lastResetAt: null
};

function parseState(value: unknown): DemoModeState {
  if (!value || typeof value !== "object") return { ...EMPTY_STATE };
  const row = value as Partial<DemoModeState>;
  return {
    active: row.active === true,
    datasetVersion: typeof row.datasetVersion === "string" ? row.datasetVersion : null,
    installedAt: typeof row.installedAt === "string" ? row.installedAt : null,
    lastResetAt: typeof row.lastResetAt === "string" ? row.lastResetAt : null
  };
}

function readState(filePath: string) {
  try {
    return parseState(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return { ...EMPTY_STATE };
  }
}

function writeState(filePath: string, state: DemoModeState) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

async function responseBytes(response: Response, maxBytes: number) {
  if (!response.ok) throw new Error(`GitHub 返回 HTTP ${response.status}`);
  assertGithubDownloadUrl(response.url || "https://github.com/");
  const length = Number(response.headers.get("content-length") || 0);
  if (length > maxBytes) throw new Error("GitHub 返回的文件超过允许大小");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error("GitHub 返回的文件超过允许大小");
  return bytes;
}

async function fetchManifest(fetchImpl: typeof fetch, manifestUrl: string) {
  assertGithubDownloadUrl(manifestUrl);
  const response = await fetchImpl(manifestUrl, {
    redirect: "follow",
    cache: "no-store",
    headers: { accept: "application/json", "user-agent": "team-chat-demo-loader" },
    signal: AbortSignal.timeout(15_000)
  });
  const bytes = await responseBytes(response, MANIFEST_MAX_BYTES);
  return assertDemoManifest(JSON.parse(Buffer.from(bytes).toString("utf8")), APP_VERSION);
}

async function downloadBundle(fetchImpl: typeof fetch, manifest: DemoManifestDTO, cacheDir: string) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const target = path.join(cacheDir, `${manifest.datasetVersion}-${manifest.bundleSha256}.tar.gz`);
  if (fs.existsSync(target) && fileDigest(target) === manifest.bundleSha256 && fs.statSync(target).size === manifest.bundleSize) return target;
  const temporaryPath = `${target}.${process.pid}.tmp`;
  const response = await fetchImpl(manifest.bundleUrl, {
    redirect: "follow",
    cache: "no-store",
    headers: { accept: "application/gzip, application/octet-stream", "user-agent": "team-chat-demo-loader" },
    signal: AbortSignal.timeout(120_000)
  });
  if (!response.ok || !response.body) throw new Error(`演示包下载失败：HTTP ${response.status}`);
  assertGithubDownloadUrl(response.url || manifest.bundleUrl);
  const advertisedLength = Number(response.headers.get("content-length") || 0);
  if (advertisedLength && advertisedLength !== manifest.bundleSize) throw new Error("演示包大小与清单不一致");
  const handle = await fs.promises.open(temporaryPath, "wx", 0o600);
  const digest = createHash("sha256");
  let received = 0;
  try {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > manifest.bundleSize) throw new Error("演示包大小超过清单声明");
      digest.update(value);
      await handle.write(value);
    }
  } finally {
    await handle.close();
  }
  if (received !== manifest.bundleSize) {
    fs.rmSync(temporaryPath, { force: true });
    throw new Error("演示包下载不完整");
  }
  if (digest.digest("hex") !== manifest.bundleSha256) {
    fs.rmSync(temporaryPath, { force: true });
    throw new Error("演示包校验失败");
  }
  fs.renameSync(temporaryPath, target);
  return target;
}

function fileDigest(filePath: string) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

async function extractBundle(archivePath: string, cacheDir: string) {
  const { stdout } = await execFileAsync("tar", ["-tzf", archivePath], { maxBuffer: 8 * 1024 * 1024 });
  const entries = stdout.split("\n").map((entry) => entry.trim()).filter(Boolean);
  if (!entries.length || entries.length > ARCHIVE_ENTRY_LIMIT || entries.some((entry) => !safeArchiveEntry(entry))) {
    throw new Error("演示包目录结构不安全");
  }
  const stagingDir = fs.mkdtempSync(path.join(cacheDir, "extract-"));
  try {
    await execFileAsync("tar", ["-xzf", archivePath, "--directory", stagingDir, "--no-same-owner", "--no-same-permissions"]);
    return stagingDir;
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

function parseSnapshot(stagingDir: string, manifest: DemoManifestDTO) {
  const snapshotPath = path.join(stagingDir, "snapshot.json");
  if (!fs.existsSync(snapshotPath) || fs.statSync(snapshotPath).size > 64 * 1024 * 1024) throw new Error("演示包缺少有效的 snapshot.json");
  const snapshot = assertDemoSnapshot(JSON.parse(fs.readFileSync(snapshotPath, "utf8")), manifest.datasetVersion);
  if (
    snapshot.accounts.length !== manifest.summary.accounts ||
    snapshot.channels.length !== manifest.summary.channels ||
    snapshot.messages.length !== manifest.summary.messages ||
    snapshot.assets.length !== manifest.summary.assets
  ) {
    throw new Error("演示包内容数量与清单不一致");
  }
  return snapshot;
}

function validateAndInstallAssets(stagingDir: string, snapshot: DemoSnapshot, storageDirs: Record<DemoAssetKind, string>) {
  const installed: string[] = [];
  for (const asset of snapshot.assets) {
    if (!safeArchiveEntry(asset.archivePath) || path.basename(asset.fileName) !== asset.fileName) throw new Error(`素材路径无效：${asset.key}`);
    const source = path.resolve(stagingDir, asset.archivePath);
    if (!source.startsWith(`${path.resolve(stagingDir)}${path.sep}`) || !fs.existsSync(source)) throw new Error(`演示素材缺失：${asset.key}`);
    const stat = fs.lstatSync(source);
    const resolvedSource = fs.realpathSync(source);
    if (
      stat.isSymbolicLink() ||
      !resolvedSource.startsWith(`${fs.realpathSync(stagingDir)}${path.sep}`) ||
      !stat.isFile() ||
      stat.size !== asset.size ||
      fileDigest(source) !== asset.sha256
    ) {
      throw new Error(`演示素材校验失败：${asset.key}`);
    }
    const destinationDir = storageDirs[asset.kind];
    fs.mkdirSync(destinationDir, { recursive: true });
    const destination = path.join(destinationDir, asset.fileName);
    if (fs.existsSync(destination)) {
      if (fs.statSync(destination).size !== asset.size || fileDigest(destination) !== asset.sha256) throw new Error(`素材文件名冲突：${asset.fileName}`);
      continue;
    }
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    installed.push(destination);
  }
  return installed;
}

function assetMap(snapshot: DemoSnapshot) {
  return new Map(snapshot.assets.map((asset) => [asset.key, asset]));
}

function requiredMapValue<T>(values: Map<string, T>, key: string, label: string) {
  const value = values.get(key);
  if (value === undefined) throw new Error(`${label}不存在：${key}`);
  return value;
}

function dateValue(value?: string) {
  return value ? new Date(value) : new Date();
}

function jsonValue(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null || value === undefined ? Prisma.JsonNull : value as Prisma.InputJsonValue;
}

function assetFile(assets: Map<string, DemoAssetRecord>, key?: string) {
  return key ? requiredMapValue(assets, key, "素材").fileName : null;
}

function characterConfig(value: Record<string, unknown> | undefined, channels: Map<string, number>) {
  const config: Record<string, unknown> = { ...(value || {}) };
  if (Array.isArray(config.channelKeys)) {
    config.channelIds = config.channelKeys.map((key) => requiredMapValue(channels, String(key), "角色频道"));
    delete config.channelKeys;
  }
  return config as Prisma.InputJsonValue;
}

function restoreMessagePayload(value: unknown, messages: Map<string, number>): unknown {
  if (Array.isArray(value)) return value.map((item) => restoreMessagePayload(item, messages));
  if (!value || typeof value !== "object") return value;
  const restored: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === "sourcePrayerMessageKey" || key === "imageMessageKey" || key === "trackMessageKey") {
      const targetKey = key === "trackMessageKey" ? "trackId" : key.replace(/Key$/, "Id");
      restored[targetKey] = requiredMapValue(messages, String(item), "消息素材引用");
    } else {
      restored[key] = restoreMessagePayload(item, messages);
    }
  }
  return restored;
}

async function rebuildDemoDatabase(prisma: PrismaClient, snapshot: DemoSnapshot, operatorAccountId: number) {
  const assets = assetMap(snapshot);
  await prisma.$transaction(async (tx) => {
    const operator = await tx.account.findUnique({ where: { id: operatorAccountId }, select: { username: true, actor: { select: { id: true } } } });
    if (!operator?.actor) throw new Error("执行复位的管理员账号不存在");
    if (snapshot.accounts.some((account) => account.username === operator.username)) throw new Error("演示账号与运维管理员用户名冲突");
    await tx.engineAction.deleteMany();
    await tx.engineEvent.deleteMany();
    await tx.characterMemory.deleteMany();
    await tx.whyAssistantRun.deleteMany();
    await tx.whyTopicRead.deleteMany();
    await tx.whyTopicMember.deleteMany();
    await tx.whyTopic.deleteMany();
    await tx.pinnedSeen.deleteMany();
    await tx.pinnedItem.deleteMany();
    await tx.musicPlaylistShare.deleteMany();
    await tx.musicPlaylistTrack.deleteMany();
    await tx.musicPlaybackState.deleteMany();
    await tx.musicPlaylist.deleteMany();
    await tx.musicFavorite.deleteMany();
    await tx.musicPlay.deleteMany();
    await tx.musicLyrics.deleteMany();
    await tx.musicScorePage.deleteMany();
    await tx.musicScore.deleteMany();
    await tx.messageFavorite.deleteMany();
    await tx.messageLike.deleteMany();
    await tx.messageAiSuggestion.deleteMany();
    await tx.prayerAction.deleteMany();
    await tx.voiceListen.deleteMany();
    await tx.message.deleteMany();
    await tx.friendPlayback.deleteMany();
    await tx.bibleFavorite.deleteMany();
    await tx.pushSubscription.deleteMany();
    await tx.channelNotificationPreference.deleteMany();
    await tx.accountActivityLog.deleteMany();
    await tx.accountLoginLog.deleteMany();
    await tx.auditLog.deleteMany();
    await tx.channelMember.deleteMany();
    await tx.channel.deleteMany();
    await tx.virtualCharacter.deleteMany();
    await tx.actor.deleteMany({ where: { OR: [{ accountId: null }, { accountId: { not: operatorAccountId } }] } });
    await tx.accountSession.deleteMany({ where: { accountId: { not: operatorAccountId } } });
    await tx.account.deleteMany({ where: { id: { not: operatorAccountId } } });
    await tx.setting.deleteMany({ where: { key: { in: [...DEMO_SAFE_SETTING_KEYS] } } });

    const accountIds = new Map<string, number>([["operator", operatorAccountId]]);
    const actorIds = new Map<string, number>([["operator", operator.actor.id]]);
    for (const account of snapshot.accounts) {
      const created = await tx.account.create({
        data: {
          username: account.username,
          passwordHash: account.passwordHash,
          displayName: account.displayName,
          avatarPath: assetFile(assets, account.avatarAssetKey),
          role: "user",
          canPinMessages: account.canPinMessages === true,
          theme: account.theme || "wechat",
          biblePreferences: jsonValue(account.biblePreferences),
          actor: {
            create: {
              kind: "human",
              username: account.username,
              displayName: account.displayName,
              avatarPath: assetFile(assets, account.avatarAssetKey)
            }
          }
        },
        include: { actor: true }
      });
      accountIds.set(account.key, created.id);
      if (!created.actor) throw new Error(`账号缺少角色：${account.key}`);
      actorIds.set(account.key, created.actor.id);
    }

    for (const actor of snapshot.actors || []) {
      const created = await tx.actor.create({
        data: {
          kind: actor.kind,
          username: actor.username,
          displayName: actor.displayName,
          avatarPath: assetFile(assets, actor.avatarAssetKey),
          status: actor.status || "active"
        }
      });
      actorIds.set(actor.key, created.id);
    }

    const channelIds = new Map<string, number>();
    for (const channel of snapshot.channels) {
      const created = await tx.channel.create({
        data: {
          kind: channel.kind || "standard",
          name: channel.name,
          description: channel.description || "",
          icon: channel.icon || "#",
          listColor: channel.listColor || null,
          isPrivate: channel.isPrivate === true,
          isDefault: channel.isDefault === true,
          directKey: channel.directKey || null
        }
      });
      channelIds.set(channel.key, created.id);
    }

    for (const character of snapshot.virtualCharacters || []) {
      const actor = await tx.actor.create({
        data: {
          kind: "virtual",
          username: character.username,
          displayName: character.displayName,
          avatarPath: assetFile(assets, character.avatarAssetKey),
          character: {
            create: {
              enabled: character.enabled !== false,
              config: characterConfig(character.config, channelIds),
              state: jsonValue(character.state),
              engineBinding: jsonValue(character.engineBinding)
            }
          }
        }
      });
      actorIds.set(character.key, actor.id);
    }

    for (const membership of snapshot.memberships) {
      await tx.channelMember.create({
        data: {
          channelId: requiredMapValue(channelIds, membership.channelKey, "频道"),
          accountId: requiredMapValue(accountIds, membership.accountKey, "账号"),
          role: membership.role || "member"
        }
      });
    }
    for (const channelId of channelIds.values()) {
      await tx.channelMember.create({ data: { channelId, accountId: operatorAccountId, role: "owner" } });
    }

    const messageIds = new Map<string, number>();
    for (const message of snapshot.messages) {
      const asset = message.assetKey ? requiredMapValue(assets, message.assetKey, "消息素材") : null;
      const created = await tx.message.create({
        data: {
          channelId: requiredMapValue(channelIds, message.channelKey, "频道"),
          senderActorId: requiredMapValue(actorIds, message.senderKey, "发送者"),
          content: message.content || "",
          type: message.type || "text",
          payload: jsonValue(message.payload),
          fileName: message.fileName ?? asset?.fileName ?? null,
          filePath: asset?.fileName ?? null,
          fileSize: message.fileSize ?? asset?.size ?? null,
          chainVersion: message.chainVersion ?? null,
          musicOrder: message.musicOrder ?? null,
          createdAt: dateValue(message.createdAt)
        }
      });
      messageIds.set(message.key, created.id);
    }
    for (const message of snapshot.messages) {
      const restoredPayload = restoreMessagePayload(message.payload, messageIds);
      await tx.message.update({
        where: { id: requiredMapValue(messageIds, message.key, "消息") },
        data: {
          replyToId: message.replyToKey ? requiredMapValue(messageIds, message.replyToKey, "回复消息") : null,
          chainRootId: message.chainRootKey ? requiredMapValue(messageIds, message.chainRootKey, "接龙消息") : null,
          payload: jsonValue(restoredPayload)
        }
      });
    }

    for (const pin of snapshot.pinnedItems || []) {
      await tx.pinnedItem.create({
        data: {
          channelId: requiredMapValue(channelIds, pin.channelKey, "置顶频道"),
          kind: "notice",
          title: pin.title || null,
          content: pin.content || null,
          body: jsonValue(pin.body),
          messageId: pin.messageKey ? requiredMapValue(messageIds, pin.messageKey, "置顶消息") : null,
          version: pin.version || 1,
          active: pin.active !== false
        }
      });
    }

    for (const relation of snapshot.messageLikes || []) {
      await tx.messageLike.create({ data: { messageId: requiredMapValue(messageIds, relation.messageKey, "点赞消息"), accountId: requiredMapValue(accountIds, relation.accountKey, "点赞账号"), createdAt: dateValue(relation.createdAt) } });
    }
    for (const relation of snapshot.messageFavorites || []) {
      await tx.messageFavorite.create({ data: { messageId: requiredMapValue(messageIds, relation.messageKey, "收藏消息"), accountId: requiredMapValue(accountIds, relation.accountKey, "收藏账号"), createdAt: dateValue(relation.createdAt) } });
    }
    for (const relation of snapshot.voiceListens || []) {
      await tx.voiceListen.create({ data: { messageId: requiredMapValue(messageIds, relation.messageKey, "语音消息"), accountId: requiredMapValue(accountIds, relation.accountKey, "收听账号"), listenedAt: dateValue(relation.createdAt) } });
    }
    for (const relation of snapshot.prayerActions || []) {
      await tx.prayerAction.create({ data: { messageId: requiredMapValue(messageIds, relation.messageKey, "代祷消息"), accountId: requiredMapValue(accountIds, relation.accountKey, "代祷账号"), prayedAt: dateValue(relation.prayedAt || relation.createdAt) } });
    }
    for (const suggestion of snapshot.messageAiSuggestions || []) {
      await tx.messageAiSuggestion.create({
        data: {
          messageId: requiredMapValue(messageIds, suggestion.messageKey, "AI 建议消息"),
          kind: suggestion.kind || "prayer_related_verses",
          status: suggestion.status || "success",
          promptCommand: suggestion.promptCommand || "",
          contextText: suggestion.contextText || "",
          responseText: suggestion.responseText || null,
          references: jsonValue(suggestion.references),
          model: suggestion.model || null,
          baseUrl: suggestion.baseUrl || null,
          createdByAccountId: suggestion.createdByAccountKey ? requiredMapValue(accountIds, suggestion.createdByAccountKey, "AI 操作账号") : null,
          createdAt: dateValue(suggestion.createdAt)
        }
      });
    }

    for (const score of snapshot.musicScores || []) {
      const created = await tx.musicScore.create({
        data: {
          trackId: requiredMapValue(messageIds, score.trackMessageKey, "曲谱歌曲"),
          title: score.title,
          uploadedByAccountId: score.uploadedByAccountKey ? requiredMapValue(accountIds, score.uploadedByAccountKey, "曲谱上传账号") : null
        }
      });
      for (const page of score.pages) {
        const asset = requiredMapValue(assets, page.assetKey, "曲谱素材");
        await tx.musicScorePage.create({
          data: {
            scoreId: created.id,
            pageIndex: page.pageIndex,
            fileName: asset.fileName,
            filePath: asset.fileName,
            fileSize: asset.size,
            width: page.width,
            height: page.height
          }
        });
      }
    }
    for (const lyrics of snapshot.musicLyrics || []) {
      await tx.musicLyrics.create({
        data: {
          trackId: requiredMapValue(messageIds, lyrics.trackMessageKey, "歌词歌曲"),
          fileName: lyrics.fileName,
          content: lyrics.content,
          uploadedByAccountId: lyrics.uploadedByAccountKey ? requiredMapValue(accountIds, lyrics.uploadedByAccountKey, "歌词上传账号") : null
        }
      });
    }

    for (const [key, value] of Object.entries(snapshot.settings)) {
      await tx.setting.create({ data: { key, value } });
    }
  }, { maxWait: 10_000, timeout: 120_000 });
}

export function createDemoModeService(options: DemoModeServiceOptions) {
  const fetchImpl = options.fetchImpl || fetch;

  async function status(loadRemoteManifest = false): Promise<DemoModeStatusDTO> {
    const state = readState(options.statePath);
    return {
      available: true,
      active: state.active,
      busy: options.gate.busy,
      datasetVersion: state.datasetVersion,
      installedAt: state.installedAt,
      lastResetAt: state.lastResetAt,
      source: options.manifestUrl,
      ...(loadRemoteManifest ? { manifest: await fetchManifest(fetchImpl, options.manifestUrl) } : {})
    };
  }

  async function reset(operator: { accountId: number; username: string }) {
    if (options.gate.busy) throw new Error("演示数据正在复位，请稍后再试");
    options.gate.busy = true;
    let stagingDir = "";
    let installedFiles: string[] = [];
    let databaseCommitted = false;
    try {
      const state = readState(options.statePath);
      const manifest = await fetchManifest(fetchImpl, options.manifestUrl);
      const archivePath = await downloadBundle(fetchImpl, manifest, options.cacheDir);
      stagingDir = await extractBundle(archivePath, options.cacheDir);
      const snapshot = parseSnapshot(stagingDir, manifest);
      installedFiles = validateAndInstallAssets(stagingDir, snapshot, options.storageDirs);
      if (!state.active) await options.createBackup(operator);
      await rebuildDemoDatabase(options.prisma, snapshot, operator.accountId);
      databaseCommitted = true;
      const resetAt = new Date().toISOString();
      writeState(options.statePath, {
        active: true,
        datasetVersion: manifest.datasetVersion,
        installedAt: state.installedAt || resetAt,
        lastResetAt: resetAt
      });
      try {
        await options.afterReset(operator.accountId, manifest.datasetVersion);
      } catch (error) {
        options.log?.("demo reset post-commit notification failed", error);
      }
      return { success: true, manifest, status: await status(false) };
    } catch (error) {
      if (!databaseCommitted) {
        for (const filePath of installedFiles) fs.rmSync(filePath, { force: true });
      }
      options.log?.("demo reset failed", error);
      throw error;
    } finally {
      if (stagingDir) fs.rmSync(stagingDir, { recursive: true, force: true });
      options.gate.busy = false;
    }
  }

  return { status, reset };
}

export type DemoModeService = ReturnType<typeof createDemoModeService>;
