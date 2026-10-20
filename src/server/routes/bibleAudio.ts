import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { applyFileResponseHeaders, applyJsonValidation } from "../fileResponses.js";
import {
  BIBLE_AUDIO_VERSION_ID_PATTERN,
  type BibleAudioManifest,
  type BibleAudioVerseTimestamp,
  type BibleAudioVersionManifest
} from "../../shared/bibleAudio.js";
import { isBibleBookCode } from "../../shared/bibleBooks.js";
import {
  BibleAudioBundleRejectedError,
  bibleAudioAdminVersions,
  bibleAudioChapterPath,
  bibleAudioVersionInfo,
  deleteBibleAudioVersion,
  importBibleAudioBundle
} from "../bibleAudio/bundleImport.js";
import { bibleBookChineseName } from "../bible/lookup.js";
import { bibleActivityAccountLabel, pushBibleActivity } from "../bibleActivityLog.js";

// 有声圣经：管理员上传卷包、读取章节索引（manifest）、鉴权流播放、功能开关。
// 资源不入 git；stream 必须鉴权（支持 ?token= 以供 <audio> 使用）。

export interface BibleAudioRouteDeps {
  prisma: PrismaClient;
  bibleAudioDir: string;
  requireAuth: preHandlerHookHandler;
  requireMediaAuth: preHandlerHookHandler;
  requireAdmin: preHandlerHookHandler;
  authFor: (request: FastifyRequest) => { accountId: number; isAdmin: boolean };
}

export const BIBLE_AUDIO_BUNDLE_MAX_BYTES = 800 * 1024 * 1024;
const SETTING_ENABLED = "bibleAudioEnabled";
const SETTING_DEFAULT_VERSION = "bibleAudioDefaultVersion";
const STREAM_CACHE_CONTROL = "private, max-age=3600";

export type BibleAudioSettings = { enabled: boolean; defaultVersion: string | null };

export function registerBibleAudioRoutes(app: FastifyInstance, deps: BibleAudioRouteDeps) {
  const { prisma, bibleAudioDir, requireAuth, requireMediaAuth, requireAdmin, authFor } = deps;
  fs.mkdirSync(bibleAudioDir, { recursive: true });
  let manifestCache: { revision: string; body: string; etag: string } | null = null;

  async function readSettings(): Promise<BibleAudioSettings> {
    const rows = await prisma.setting.findMany({ where: { key: { in: [SETTING_ENABLED, SETTING_DEFAULT_VERSION] } } });
    const map = new Map(rows.map((row) => [row.key, row.value]));
    const defaultVersion = (map.get(SETTING_DEFAULT_VERSION) || "").trim();
    return {
      enabled: map.get(SETTING_ENABLED) === "true",
      defaultVersion: BIBLE_AUDIO_VERSION_ID_PATTERN.test(defaultVersion) ? defaultVersion : null
    };
  }

  async function writeSettings(settings: BibleAudioSettings) {
    for (const [key, value] of [
      [SETTING_ENABLED, settings.enabled ? "true" : "false"],
      [SETTING_DEFAULT_VERSION, settings.defaultVersion || ""]
    ] as const) {
      await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    }
  }

  async function manifestRevision(settings: BibleAudioSettings) {
    const [versions, chapters] = await Promise.all([
      prisma.bibleAudioVersion.findMany({ select: { id: true, updatedAt: true }, orderBy: { id: "asc" } }),
      prisma.bibleAudioChapter.aggregate({ _count: { _all: true }, _max: { updatedAt: true } })
    ]);
    return [
      settings.enabled ? "1" : "0",
      settings.defaultVersion || "",
      versions.map((version) => `${version.id}:${version.updatedAt.getTime()}`).join(","),
      String(chapters._count._all),
      String(chapters._max.updatedAt?.getTime() || 0)
    ].join("|");
  }

  async function buildManifest(settings: BibleAudioSettings): Promise<BibleAudioManifest> {
    const versions = await prisma.bibleAudioVersion.findMany({ orderBy: { createdAt: "asc" } });
    const result: BibleAudioVersionManifest[] = [];
    for (const version of versions) {
      const chapters = await prisma.bibleAudioChapter.findMany({
        where: { versionId: version.id },
        orderBy: [{ bookCode: "asc" }, { chapter: "asc" }],
        select: { bookCode: true, chapter: true, durationMs: true, verses: true }
      });
      result.push({
        ...bibleAudioVersionInfo(version),
        chapters: chapters.map((chapter) => ({
          book: chapter.bookCode,
          chapter: chapter.chapter,
          durationMs: chapter.durationMs,
          verses: chapter.verses as unknown as BibleAudioVerseTimestamp[]
        }))
      });
    }
    const defaultVersionId = result.some((version) => version.versionId === settings.defaultVersion) ? settings.defaultVersion : null;
    return { enabled: true, defaultVersionId, versions: result };
  }

  app.get("/api/bible-audio/manifest", { preHandler: requireAuth }, async (request, reply) => {
    const settings = await readSettings();
    if (!settings.enabled) {
      const disabled: BibleAudioManifest = { enabled: false, defaultVersionId: null, versions: [] };
      reply.header("Cache-Control", "private, no-cache");
      return disabled;
    }
    const revision = await manifestRevision(settings);
    if (!manifestCache || manifestCache.revision !== revision) {
      const body = JSON.stringify(await buildManifest(settings));
      manifestCache = { revision, body, etag: `"${crypto.createHash("sha1").update(body).digest("hex")}"` };
    }
    if (applyJsonValidation(request, reply, manifestCache.etag)) return reply.code(304).send();
    reply.type("application/json; charset=utf-8");
    return reply.send(manifestCache.body);
  });

  app.get("/api/bible-audio/:versionId/:book/:chapter/stream", { preHandler: requireMediaAuth }, async (request, reply) => {
    const params = z
      .object({
        versionId: z.string().regex(BIBLE_AUDIO_VERSION_ID_PATTERN),
        book: z.string().transform((value) => value.toUpperCase()).refine(isBibleBookCode),
        chapter: z.coerce.number().int().positive().max(150)
      })
      .safeParse(request.params);
    if (!params.success) return reply.code(400).send({ success: false, message: "无效的章节" });
    const settings = await readSettings();
    if (!settings.enabled && !authFor(request).isAdmin) return reply.code(403).send({ success: false, message: "有声圣经功能未开启" });
    const version = await prisma.bibleAudioVersion.findUnique({ where: { versionId: params.data.versionId } });
    if (!version) return reply.code(404).send({ success: false, message: "有声圣经版本不存在" });
    const row = await prisma.bibleAudioChapter.findUnique({
      where: { versionId_bookCode_chapter: { versionId: version.id, bookCode: params.data.book, chapter: params.data.chapter } }
    });
    if (!row) return reply.code(404).send({ success: false, message: "该章音频尚未上传" });
    const filePath = bibleAudioChapterPath(bibleAudioDir, version.versionId, row.bookCode, row.fileName);
    if (!fs.existsSync(filePath)) return reply.code(404).send({ success: false, message: "音频文件不存在" });
    const stat = fs.statSync(filePath);
    // 使用日志：每个章节的首次（非 Range）加载记一条「听圣经」；拖动进度产生的分段请求不重复记录。
    if (!request.headers.range) {
      const { accountId } = authFor(request);
      void bibleActivityAccountLabel(prisma, accountId)
        .then((account) => pushBibleActivity("听圣经", `${bibleBookChineseName(params.data.book)} ${params.data.chapter}章`, account))
        .catch(() => {});
    }
    return sendAudioFile(request, reply, filePath, row.fileName, stat);
  });

  app.get("/api/admin/bible-audio/versions", { preHandler: requireAdmin }, async () => {
    const [versions, settings] = await Promise.all([bibleAudioAdminVersions(prisma), readSettings()]);
    return { success: true, versions, settings };
  });

  app.post("/api/admin/bible-audio/bundles", { preHandler: requireAdmin }, async (request, reply) => {
    const part = await request.file({ limits: { fileSize: BIBLE_AUDIO_BUNDLE_MAX_BYTES, files: 1 } });
    if (!part) return reply.code(400).send({ success: false, message: "请选择要上传的卷包 zip" });
    const temporaryPath = path.join(bibleAudioDir, `.upload-${crypto.randomUUID()}.tmp`);
    try {
      if (!(part.filename || "").toLowerCase().endsWith(".zip")) {
        await part.toBuffer().catch(() => Buffer.alloc(0));
        return reply.code(400).send({ success: false, message: "只支持 .zip 卷包" });
      }
      await new Promise<void>((resolve, rejectWrite) => {
        const stream = fs.createWriteStream(temporaryPath);
        part.file.pipe(stream);
        part.file.on("error", rejectWrite);
        stream.on("finish", resolve);
        stream.on("error", rejectWrite);
      });
      if (part.file.truncated) return reply.code(413).send({ success: false, message: "卷包超过 800MB 上限" });
      const archive = fs.readFileSync(temporaryPath);
      const result = await importBibleAudioBundle({ prisma, bibleAudioDir }, archive);
      manifestCache = null;
      return reply.code(201).send({ success: true, ...result });
    } catch (error) {
      if (error instanceof BibleAudioBundleRejectedError) return reply.code(400).send({ success: false, message: error.message });
      throw error;
    } finally {
      fs.rmSync(temporaryPath, { force: true });
    }
  });

  app.post("/api/admin/bible-audio/settings", { preHandler: requireAdmin }, async (request, reply) => {
    const body = z
      .object({
        enabled: z.boolean().optional(),
        defaultVersion: z.string().regex(BIBLE_AUDIO_VERSION_ID_PATTERN).nullable().optional()
      })
      .strict()
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ success: false, message: "无效的设置" });
    const current = await readSettings();
    const next: BibleAudioSettings = {
      enabled: body.data.enabled ?? current.enabled,
      defaultVersion: body.data.defaultVersion !== undefined ? body.data.defaultVersion : current.defaultVersion
    };
    const version = next.defaultVersion ? await prisma.bibleAudioVersion.findUnique({ where: { versionId: next.defaultVersion } }) : null;
    if (next.defaultVersion && !version) return reply.code(400).send({ success: false, message: "默认版本不存在" });
    if (next.enabled) {
      if (!version) return reply.code(400).send({ success: false, message: "请先选择默认有声圣经版本" });
      if (!version.completed) return reply.code(400).send({ success: false, message: "有声圣经资源未上传完整，无法开启" });
    }
    await writeSettings(next);
    manifestCache = null;
    return { success: true, settings: next };
  });

  app.delete("/api/admin/bible-audio/versions/:versionId", { preHandler: requireAdmin }, async (request, reply) => {
    const params = z.object({ versionId: z.string().regex(BIBLE_AUDIO_VERSION_ID_PATTERN) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ success: false, message: "无效的版本" });
    const removed = await deleteBibleAudioVersion({ prisma, bibleAudioDir }, params.data.versionId);
    if (!removed) return reply.code(404).send({ success: false, message: "有声圣经版本不存在" });
    const current = await readSettings();
    let disabled = false;
    if (current.defaultVersion === params.data.versionId) {
      disabled = current.enabled;
      await writeSettings({ enabled: false, defaultVersion: null });
    }
    manifestCache = null;
    return { success: true, settings: await readSettings(), disabled };
  });
}

function sendAudioFile(request: FastifyRequest, reply: FastifyReply, filePath: string, fileName: string, stat: fs.Stats) {
  // 章节文件名固定（如 TIT_001.mp3），重传会替换内容，所以不能用一年 immutable 缓存；
  // 用弱 ETag + 短 max-age 让浏览器按需重新校验。
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  reply.header("Accept-Ranges", "bytes");
  applyFileResponseHeaders(reply, fileName, false);
  reply.header("ETag", etag);
  reply.header("Last-Modified", stat.mtime.toUTCString());
  reply.header("Cache-Control", STREAM_CACHE_CONTROL);
  if (String(request.headers["if-none-match"] || "") === etag) return reply.code(304).send();
  const range = request.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      const suffixLength = !match[1] && match[2] ? Number(match[2]) : 0;
      const start = suffixLength > 0 ? Math.max(0, stat.size - suffixLength) : match[1] ? Number(match[1]) : 0;
      const end = suffixLength > 0 ? stat.size - 1 : match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
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
}
