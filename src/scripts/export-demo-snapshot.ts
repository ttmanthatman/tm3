import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import type { DemoAssetKind, DemoAssetRecord, DemoSnapshot } from "../shared/demoMode.js";
import { DEMO_BUNDLE_FORMAT_VERSION } from "../shared/demoMode.js";
import { DEMO_SAFE_SETTING_KEYS, assertDemoSnapshot } from "../server/demo/bundle.js";

const root = process.cwd();
const storageRoot = path.resolve(process.env.STORAGE_ROOT || path.join(root, "storage"));
const appearanceStorageRoot = path.resolve(process.env.DEMO_APPEARANCE_STORAGE_ROOT || storageRoot);
const operatorUsername = process.env.DEMO_OPERATOR_USERNAME || "demo_admin";
const datasetVersion = process.env.DEMO_DATASET_VERSION || new Date().toISOString().slice(0, 10).replace(/-/g, ".");
const outputDir = path.resolve(process.env.DEMO_BUNDLE_OUTPUT || path.join(root, "output", "demo-bundle"));
const bundleUrl = process.env.DEMO_BUNDLE_URL || "https://github.com/ttmanthatman/tm3/releases/download/demo-data/demo-bundle.tar.gz";
const minAppVersion = process.env.DEMO_MIN_APP_VERSION || "1.9.4";
const maxAppVersion = process.env.DEMO_MAX_APP_VERSION || "2.0.0";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (outputDir === root || !outputDir.startsWith(`${root}${path.sep}`)) throw new Error("DEMO_BUNDLE_OUTPUT 必须位于项目目录内");

const APPEARANCE_SETTING_KEYS = new Set([
  "appTitle",
  "appIconPath",
  "wallpaperPath",
  "wallpaperFit",
  "wallpaperPanFocusX",
  "wallpaperPanDirection",
  "wallpaperPanSpeed",
  "parallaxKit",
  "parallaxSpeed",
  "parallaxKits",
  "loginIconPath",
  "loginShowIcon",
  "loginTitle",
  "loginSubtitle",
  "loginShowSubtitle",
  "loginBackgroundPath",
  "loginBackgroundFit",
  "loginFormPosition",
  "customThemes",
  "flashEffect",
  "prayerBubbleMineColor",
  "prayerBubbleOtherColor"
]);

function storageDirectory(rootPath: string, kind: DemoAssetKind) {
  if (kind === "upload") return path.join(rootPath, "uploads");
  if (kind === "avatar") return path.join(rootPath, "avatars");
  if (kind === "background") return path.join(rootPath, "backgrounds");
  if (kind === "parallax") return path.join(rootPath, "parallax");
  return path.join(rootPath, "music-scores");
}

function sha256(filePath: string) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function safeKey(prefix: string, value: string | number) {
  const cleaned = String(value).toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 55) || "item";
  return `${prefix}-${cleaned}`;
}

function jsonRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function rewritePayloadReferences(value: unknown, messageKeys: Map<number, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => rewritePayloadReferences(item, messageKeys));
  if (!value || typeof value !== "object") return value;
  const rewritten: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if ((key === "sourcePrayerMessageId" || key === "imageMessageId" || key === "trackId") && typeof item === "number" && messageKeys.has(item)) {
      const targetKey = key === "trackId" ? "trackMessageKey" : key.replace(/Id$/, "Key");
      rewritten[targetKey] = messageKeys.get(item);
    } else {
      rewritten[key] = rewritePayloadReferences(item, messageKeys);
    }
  }
  return rewritten;
}

function roleConfigWithChannelKeys(value: unknown, channelKeys: Map<number, string>) {
  const config = { ...jsonRecord(value) };
  if (Array.isArray(config.channelIds)) {
    config.channelKeys = config.channelIds.map((id) => channelKeys.get(Number(id))).filter((key): key is string => !!key);
    delete config.channelIds;
  }
  return config;
}

const prisma = new PrismaClient();
const appearancePrisma = process.env.DEMO_APPEARANCE_DATABASE_URL
  ? new PrismaClient({ datasources: { db: { url: process.env.DEMO_APPEARANCE_DATABASE_URL } } })
  : null;

const stagingDir = `${outputDir}.staging-${process.pid}`;
fs.rmSync(stagingDir, { recursive: true, force: true });
fs.mkdirSync(path.join(stagingDir, "assets"), { recursive: true });

try {
  const operator = await prisma.account.findUnique({ where: { username: operatorUsername }, include: { actor: true } });
  if (!operator?.actor || operator.role !== "admin") throw new Error(`没有找到运维管理员账号：${operatorUsername}`);

  const [accounts, channels, virtualCharacters, standaloneActorCandidates, messages, pinnedItems, messageLikes, messageFavorites, voiceListens, prayerActions, messageAiSuggestions, musicScores, musicLyrics, settingsRows] = await Promise.all([
    prisma.account.findMany({ where: { id: { not: operator.id } }, include: { actor: true }, orderBy: { id: "asc" } }),
    prisma.channel.findMany({ include: { members: true }, orderBy: { id: "asc" } }),
    prisma.virtualCharacter.findMany({ include: { actor: true }, orderBy: { id: "asc" } }),
    prisma.actor.findMany({ where: { accountId: null }, orderBy: { id: "asc" } }),
    prisma.message.findMany({ orderBy: { id: "asc" } }),
    prisma.pinnedItem.findMany({ orderBy: { id: "asc" } }),
    prisma.messageLike.findMany({ orderBy: { id: "asc" } }),
    prisma.messageFavorite.findMany({ orderBy: { id: "asc" } }),
    prisma.voiceListen.findMany({ orderBy: { id: "asc" } }),
    prisma.prayerAction.findMany({ orderBy: { id: "asc" } }),
    prisma.messageAiSuggestion.findMany({ orderBy: { id: "asc" } }),
    prisma.musicScore.findMany({ include: { pages: { orderBy: { pageIndex: "asc" } } }, orderBy: { id: "asc" } }),
    prisma.musicLyrics.findMany({ orderBy: { id: "asc" } }),
    prisma.setting.findMany({ where: { key: { in: [...DEMO_SAFE_SETTING_KEYS] } } })
  ]);

  const appearanceRows = appearancePrisma
    ? await appearancePrisma.setting.findMany({ where: { key: { in: [...APPEARANCE_SETTING_KEYS] } } })
    : settingsRows.filter((row) => APPEARANCE_SETTING_KEYS.has(row.key));
  const settings = new Map(settingsRows.map((row) => [row.key, row.value]));
  for (const row of appearanceRows) settings.set(row.key, row.value);

  const accountKeys = new Map<number, string>([[operator.id, "operator"]]);
  const actorKeys = new Map<number, string>([[operator.actor.id, "operator"]]);
  for (const account of accounts) {
    const key = safeKey("account", account.username);
    accountKeys.set(account.id, key);
    if (!account.actor) throw new Error(`账号缺少 Actor：${account.username}`);
    actorKeys.set(account.actor.id, key);
  }
  for (const character of virtualCharacters) actorKeys.set(character.actorId, safeKey("character", character.actor.username));
  const virtualActorIds = new Set(virtualCharacters.map((character) => character.actorId));
  const standaloneActors = standaloneActorCandidates.filter((actor) => !virtualActorIds.has(actor.id));
  for (const actor of standaloneActors) actorKeys.set(actor.id, safeKey("actor", actor.username));
  const channelKeys = new Map(channels.map((channel) => [channel.id, safeKey("channel", `${channel.id}-${channel.name}`)]));
  const messageKeys = new Map(messages.map((message) => [message.id, `message-${message.id}`]));

  for (const message of messages) {
    if (!actorKeys.has(message.senderActorId)) throw new Error(`消息 ${message.id} 的发送者不在演示快照中`);
  }

  const assets: DemoAssetRecord[] = [];
  const assetsByIdentity = new Map<string, DemoAssetRecord>();
  function addAsset(kind: DemoAssetKind, rawFileName: string | null | undefined, sourceRoot = storageRoot) {
    if (!rawFileName) return undefined;
    const fileName = path.basename(rawFileName);
    const source = path.join(storageDirectory(sourceRoot, kind), fileName);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error(`找不到演示素材：${kind}/${fileName}`);
    const digest = sha256(source);
    const identity = `${kind}:${fileName}:${digest}`;
    const existing = assetsByIdentity.get(identity);
    if (existing) return existing.key;
    const fileNameDigest = createHash("sha256").update(fileName).digest("hex").slice(0, 8);
    const key = safeKey(`asset-${kind}`, `${digest.slice(0, 20)}-${fileNameDigest}`);
    const archivePath = `assets/${kind}/${fileName}`;
    const destination = path.join(stagingDir, archivePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    const record: DemoAssetRecord = { key, kind, fileName, archivePath, sha256: digest, size: fs.statSync(source).size };
    assets.push(record);
    assetsByIdentity.set(identity, record);
    return key;
  }

  const snapshotAccounts = accounts.map((account) => ({
    key: accountKeys.get(account.id)!,
    username: account.username,
    passwordHash: account.passwordHash,
    displayName: account.displayName,
    ...(account.avatarPath ? { avatarAssetKey: addAsset("avatar", account.avatarPath) } : {}),
    canPinMessages: account.canPinMessages,
    theme: account.theme,
    biblePreferences: account.biblePreferences
  }));

  const snapshotCharacters = virtualCharacters.map((character) => ({
    key: actorKeys.get(character.actorId)!,
    username: character.actor.username,
    displayName: character.actor.displayName,
    ...(character.actor.avatarPath ? { avatarAssetKey: addAsset("avatar", character.actor.avatarPath) } : {}),
    enabled: character.enabled,
    config: roleConfigWithChannelKeys(character.config, channelKeys),
    state: jsonRecord(character.state),
    engineBinding: jsonRecord(character.engineBinding)
  }));

  const snapshotActors = standaloneActors.map((actor) => ({
    key: actorKeys.get(actor.id)!,
    kind: actor.kind === "system" ? "system" as const : "virtual" as const,
    username: actor.username,
    displayName: actor.displayName,
    ...(actor.avatarPath ? { avatarAssetKey: addAsset("avatar", actor.avatarPath) } : {}),
    status: actor.status
  }));

  const snapshotChannels = channels.map((channel) => {
    const imageIcon = channel.icon && fs.existsSync(path.join(storageDirectory(storageRoot, "background"), path.basename(channel.icon)))
      ? addAsset("background", channel.icon)
      : undefined;
    return {
      key: channelKeys.get(channel.id)!,
      kind: channel.kind,
      name: channel.name,
      description: channel.description,
      icon: imageIcon ? path.basename(channel.icon) : channel.icon,
      isPrivate: channel.isPrivate,
      isDefault: channel.isDefault,
      directKey: channel.directKey
    };
  });

  const memberships = channels.flatMap((channel) => channel.members
    .filter((member) => member.accountId !== operator.id && accountKeys.has(member.accountId))
    .map((member) => ({ channelKey: channelKeys.get(channel.id)!, accountKey: accountKeys.get(member.accountId)!, role: member.role })));

  const snapshotMessages = messages.map((message) => ({
    key: messageKeys.get(message.id)!,
    channelKey: channelKeys.get(message.channelId)!,
    senderKey: actorKeys.get(message.senderActorId)!,
    content: message.content,
    type: message.type,
    payload: rewritePayloadReferences(message.payload, messageKeys),
    ...(message.filePath ? { assetKey: addAsset("upload", message.filePath) } : {}),
    fileName: message.fileName,
    fileSize: message.fileSize,
    replyToKey: message.replyToId ? messageKeys.get(message.replyToId) || null : null,
    chainRootKey: message.chainRootId ? messageKeys.get(message.chainRootId) || null : null,
    chainVersion: message.chainVersion,
    musicOrder: message.musicOrder,
    createdAt: message.createdAt.toISOString()
  }));

  const relationAccountKey = (accountId: number) => {
    const key = accountKeys.get(accountId);
    if (!key) throw new Error(`互动账号不在演示快照中：${accountId}`);
    return key;
  };
  const relationMessageKey = (messageId: number) => {
    const key = messageKeys.get(messageId);
    if (!key) throw new Error(`互动消息不在演示快照中：${messageId}`);
    return key;
  };

  const snapshot: DemoSnapshot = {
    formatVersion: DEMO_BUNDLE_FORMAT_VERSION,
    datasetVersion,
    generatedAt: new Date().toISOString(),
    assets,
    accounts: snapshotAccounts,
    actors: snapshotActors,
    virtualCharacters: snapshotCharacters,
    channels: snapshotChannels,
    memberships,
    messages: snapshotMessages,
    pinnedItems: pinnedItems.map((pin) => ({
      key: `pin-${pin.id}`,
      channelKey: channelKeys.get(pin.channelId)!,
      title: pin.title,
      content: pin.content,
      body: pin.body,
      messageKey: pin.messageId ? messageKeys.get(pin.messageId) || null : null,
      version: pin.version,
      active: pin.active
    })),
    messageLikes: messageLikes.map((relation) => ({ accountKey: relationAccountKey(relation.accountId), messageKey: relationMessageKey(relation.messageId), createdAt: relation.createdAt.toISOString() })),
    messageFavorites: messageFavorites.map((relation) => ({ accountKey: relationAccountKey(relation.accountId), messageKey: relationMessageKey(relation.messageId), createdAt: relation.createdAt.toISOString() })),
    voiceListens: voiceListens.map((relation) => ({ accountKey: relationAccountKey(relation.accountId), messageKey: relationMessageKey(relation.messageId), createdAt: relation.listenedAt.toISOString() })),
    prayerActions: prayerActions.map((relation) => ({ accountKey: relationAccountKey(relation.accountId), messageKey: relationMessageKey(relation.messageId), prayedAt: relation.prayedAt.toISOString() })),
    messageAiSuggestions: messageAiSuggestions.map((suggestion) => ({
      messageKey: relationMessageKey(suggestion.messageId),
      kind: suggestion.kind,
      status: suggestion.status,
      promptCommand: suggestion.promptCommand,
      contextText: suggestion.contextText,
      responseText: suggestion.responseText,
      references: suggestion.references,
      model: suggestion.model,
      baseUrl: suggestion.baseUrl,
      createdByAccountKey: suggestion.createdByAccountId ? relationAccountKey(suggestion.createdByAccountId) : null,
      createdAt: suggestion.createdAt.toISOString()
    })),
    musicScores: musicScores.filter((score) => score.trackId && messageKeys.has(score.trackId)).map((score) => ({
      key: `score-${score.id}`,
      trackMessageKey: messageKeys.get(score.trackId!)!,
      title: score.title,
      uploadedByAccountKey: score.uploadedByAccountId ? relationAccountKey(score.uploadedByAccountId) : null,
      pages: score.pages.map((page) => ({ assetKey: addAsset("music-score", page.filePath)!, pageIndex: page.pageIndex, width: page.width, height: page.height }))
    })),
    musicLyrics: musicLyrics.filter((lyrics) => lyrics.trackId && messageKeys.has(lyrics.trackId)).map((lyrics) => ({
      trackMessageKey: messageKeys.get(lyrics.trackId!)!,
      fileName: lyrics.fileName,
      content: lyrics.content,
      uploadedByAccountKey: lyrics.uploadedByAccountId ? relationAccountKey(lyrics.uploadedByAccountId) : null
    })),
    settings: Object.fromEntries(settings)
  };

  const appearanceAssetSettings: Array<[string, DemoAssetKind]> = [
    ["appIconPath", "background"],
    ["wallpaperPath", "background"],
    ["loginIconPath", "background"],
    ["loginBackgroundPath", "background"]
  ];
  for (const [settingKey, kind] of appearanceAssetSettings) {
    const fileName = settings.get(settingKey);
    if (fileName) addAsset(kind, fileName, appearanceStorageRoot);
  }
  const parallaxKits = JSON.parse(settings.get("parallaxKits") || "[]") as unknown;
  if (Array.isArray(parallaxKits)) {
    for (const kit of parallaxKits) {
      const layers = jsonRecord(kit).layers;
      if (!Array.isArray(layers)) continue;
      for (const layer of layers) {
        const fileName = jsonRecord(layer).fileName;
        if (typeof fileName === "string") addAsset("parallax", fileName, appearanceStorageRoot);
      }
    }
  }

  assertDemoSnapshot(snapshot, datasetVersion);
  fs.writeFileSync(path.join(stagingDir, "snapshot.json"), `${JSON.stringify(snapshot, null, 2)}\n`);
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  const archivePath = path.join(outputDir, "demo-bundle.tar.gz");
  execFileSync("tar", ["-czf", archivePath, "--directory", stagingDir, "snapshot.json", "assets"]);
  const archiveSize = fs.statSync(archivePath).size;
  const archiveSha256 = sha256(archivePath);
  const manifest = {
    formatVersion: DEMO_BUNDLE_FORMAT_VERSION,
    datasetVersion,
    compatibleApp: { min: minAppVersion, maxExclusive: maxAppVersion },
    bundleUrl,
    bundleSha256: archiveSha256,
    bundleSize: archiveSize,
    summary: {
      accounts: snapshot.accounts.length,
      channels: snapshot.channels.length,
      messages: snapshot.messages.length,
      assets: snapshot.assets.length
    }
  };
  fs.writeFileSync(path.join(outputDir, "demo-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`演示包已生成：${outputDir}`);
  console.log(`数据版本：${datasetVersion}，账号 ${snapshot.accounts.length}，频道 ${snapshot.channels.length}，消息 ${snapshot.messages.length}，素材 ${snapshot.assets.length}`);
} finally {
  fs.rmSync(stagingDir, { recursive: true, force: true });
  await prisma.$disconnect();
  await appearancePrisma?.$disconnect();
}
