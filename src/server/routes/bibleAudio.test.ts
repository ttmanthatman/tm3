/// <reference types="node" />

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import Fastify, { type FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import { zipArchive, type ZipArchiveEntry } from "../zipArchive.js";
import { BibleAudioBundleRejectedError, parseBibleAudioBundle } from "../bibleAudio/bundleImport.js";
import { registerBibleAudioRoutes, type BibleListenLogInput } from "./bibleAudio.js";

type VersionRow = {
  id: number;
  versionId: string;
  name: string;
  language: string;
  dialect: string | null;
  style: string | null;
  translation: string;
  copyright: string;
  bookCount: number;
  chapterCount: number;
  totalBytes: bigint;
  completed: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type ChapterRow = {
  id: number;
  versionId: number;
  bookCode: string;
  chapter: number;
  fileName: string;
  bytes: bigint;
  md5: string;
  durationMs: number;
  verses: unknown;
  updatedAt: Date;
};

type Role = "admin" | "user" | "anonymous";

function chapterAudio(seed: number, size = 2048) {
  const data = Buffer.alloc(size);
  for (let index = 0; index < size; index += 1) data[index] = (seed * 31 + index * 7) & 0xff;
  return data;
}

type BundleOverrides = {
  manifest?: (manifest: Record<string, unknown>) => Record<string, unknown> | void;
  files?: (files: Map<string, Buffer>) => void;
  omitManifest?: boolean;
};

function buildBundle(overrides: BundleOverrides = {}) {
  const book = { code: "TIT", nameZh: "提多书", chapterCount: 3 };
  const files = new Map<string, Buffer>();
  const chapters = [1, 2, 3].map((chapter) => {
    const data = chapterAudio(chapter);
    const file = `audio/TIT/TIT_${String(chapter).padStart(3, "0")}.mp3`;
    files.set(file, data);
    return {
      book: "TIT",
      chapter,
      file,
      bytes: data.length,
      md5: createHash("md5").update(data).digest("hex"),
      durationMs: 180_000 + chapter,
      verses: [
        { verse: 0, startMs: 0, endMs: 5000 },
        { verse: 1, startMs: 5000, endMs: 15000 },
        { verse: 2, startMs: 15000, endMs: 30000 }
      ]
    };
  });
  let manifest: Record<string, unknown> = {
    formatVersion: 1,
    versionId: "cuvmpt-drama",
    name: "华语有声戏剧圣经",
    language: "zh-Hans",
    dialect: "zh",
    style: "drama",
    narration: "和合本",
    translation: "cmn-cu89s",
    copyright: "© 2020 The Grace & Mercy Foundation",
    audioFormat: "mp3 44.1kHz VBR",
    chapterFilePattern: "audio/{BOOK}/{BOOK}_{CH:03d}.mp3",
    book,
    chapters
  };
  if (overrides.manifest) manifest = overrides.manifest(manifest) || manifest;
  overrides.files?.(files);
  const entries: ZipArchiveEntry[] = [];
  if (!overrides.omitManifest) entries.push({ name: "bundle.json", data: Buffer.from(JSON.stringify(manifest)) });
  for (const [name, data] of files) entries.push({ name, data });
  return { archive: zipArchive(entries), entries, manifest, files };
}

function createFakePrisma() {
  const settings = new Map<string, string>();
  const versions = new Map<number, VersionRow>();
  const chapters = new Map<number, ChapterRow>();
  let nextVersionId = 1;
  let nextChapterId = 1;
  const findVersion = (where: { id?: number; versionId?: string }) =>
    [...versions.values()].find((row) => (where.id !== undefined ? row.id === where.id : row.versionId === where.versionId)) ?? null;
  const matchChapter = (row: ChapterRow, where: Record<string, unknown>) =>
    (where.versionId === undefined || row.versionId === where.versionId) &&
    (where.bookCode === undefined || row.bookCode === where.bookCode) &&
    (where.chapter === undefined || row.chapter === where.chapter);
  const sortChapters = (rows: ChapterRow[]) => rows.sort((left, right) => left.bookCode.localeCompare(right.bookCode) || left.chapter - right.chapter);
  const prisma = {
    setting: {
      findMany: async ({ where }: { where: { key: { in: string[] } } }) =>
        where.key.in.filter((key) => settings.has(key)).map((key) => ({ key, value: settings.get(key) as string })),
      upsert: async ({ where, update, create }: { where: { key: string }; update: { value: string }; create: { key: string; value: string } }) => {
        settings.set(where.key, settings.has(where.key) ? update.value : create.value);
      }
    },
    bibleAudioVersion: {
      findMany: async () => [...versions.values()].sort((left, right) => left.id - right.id),
      findUnique: async ({ where }: { where: { id?: number; versionId?: string } }) => findVersion(where),
      upsert: async ({ where, create, update }: { where: { versionId: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const existing = findVersion(where);
        if (existing) {
          Object.assign(existing, update, { updatedAt: new Date() });
          return existing;
        }
        const row: VersionRow = {
          id: nextVersionId++,
          versionId: String(create.versionId),
          name: String(create.name),
          language: String(create.language),
          dialect: (create.dialect as string | null) ?? null,
          style: (create.style as string | null) ?? null,
          translation: String(create.translation),
          copyright: String(create.copyright),
          bookCount: 0,
          chapterCount: 0,
          totalBytes: 0n,
          completed: false,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        versions.set(row.id, row);
        return row;
      },
      update: async ({ where, data }: { where: { id: number }; data: Partial<VersionRow> }) => {
        const row = versions.get(where.id);
        if (!row) throw new Error("version missing");
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
      delete: async ({ where }: { where: { id: number } }) => {
        versions.delete(where.id);
        for (const [id, row] of chapters) if (row.versionId === where.id) chapters.delete(id);
      }
    },
    bibleAudioChapter: {
      findMany: async ({ where, distinct }: { where: Record<string, unknown>; distinct?: string[] }) => {
        let rows = sortChapters([...chapters.values()].filter((row) => matchChapter(row, where)));
        if (distinct?.includes("bookCode")) {
          const seen = new Set<string>();
          rows = rows.filter((row) => !seen.has(row.bookCode) && seen.add(row.bookCode));
        }
        return rows;
      },
      findUnique: async ({ where }: { where: { versionId_bookCode_chapter: { versionId: number; bookCode: string; chapter: number } } }) =>
        [...chapters.values()].find((row) => matchChapter(row, where.versionId_bookCode_chapter)) ?? null,
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        let count = 0;
        for (const [id, row] of chapters) {
          if (matchChapter(row, where)) {
            chapters.delete(id);
            count += 1;
          }
        }
        return { count };
      },
      createMany: async ({ data }: { data: Omit<ChapterRow, "id" | "updatedAt">[] }) => {
        for (const item of data) chapters.set(nextChapterId, { ...item, id: nextChapterId++, updatedAt: new Date() });
        return { count: data.length };
      },
      aggregate: async () => ({
        _count: { _all: chapters.size },
        _max: { updatedAt: [...chapters.values()].reduce<Date | null>((max, row) => (!max || row.updatedAt > max ? row.updatedAt : max), null) }
      })
    },
    $transaction: async <T>(run: (transaction: unknown) => Promise<T>) => run(prisma)
  };
  return { prisma, settings, versions, chapters };
}

type SharedState = ReturnType<typeof createFakePrisma> & { dir: string; activity: BibleListenLogInput[] };

async function createHarness(role: Role = "admin", shared?: SharedState) {
  const state = shared ?? { ...createFakePrisma(), dir: fs.mkdtempSync(path.join(os.tmpdir(), "bible-audio-test-")), activity: [] as BibleListenLogInput[] };
  const app = Fastify();
  await app.register(multipart, { limits: { fileSize: 80 * 1024 * 1024, files: 1 } });
  type Reply = { sent: boolean; code: (status: number) => { send: (body: unknown) => unknown } };
  const requireAuth = async (_request: FastifyRequest, reply: Reply) => {
    if (role === "anonymous") reply.code(401).send({ success: false, message: "认证失败" });
  };
  const requireAdmin = async (_request: FastifyRequest, reply: Reply) => {
    if (role === "anonymous") reply.code(401).send({ success: false, message: "认证失败" });
    else if (role !== "admin") reply.code(403).send({ success: false, message: "需要管理员权限" });
  };
  registerBibleAudioRoutes(app, {
    prisma: state.prisma as unknown as PrismaClient,
    bibleAudioDir: state.dir,
    requireAuth: requireAuth as never,
    requireMediaAuth: requireAuth as never,
    requireAdmin: requireAdmin as never,
    authFor: () => ({ accountId: 7, isAdmin: role === "admin", isGuest: false, sessionId: "sess-7" }),
    writeActivityLog: async (input) => {
      state.activity.push(input);
    }
  });
  return { ...state, app };
}

async function uploadBundle(app: Fastify.FastifyInstance, data: Buffer, filename = "bible-audio-cuvmpt-drama-TIT.zip") {
  const boundary = "----bibleaudioboundary";
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/zip\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return app.inject({
    method: "POST",
    url: "/api/admin/bible-audio/bundles",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([head, data, tail])
  });
}

function rejectsWith(entries: ZipArchiveEntry[], pattern: RegExp) {
  assert.throws(() => parseBibleAudioBundle(entries), (error: unknown) => error instanceof BibleAudioBundleRejectedError && pattern.test(error.message));
}

test("parseBibleAudioBundle accepts a complete book bundle", () => {
  const bundle = parseBibleAudioBundle(buildBundle().entries);
  assert.equal(bundle.versionId, "cuvmpt-drama");
  assert.equal(bundle.book.code, "TIT");
  assert.deepEqual(bundle.chapters.map((chapter) => chapter.chapter), [1, 2, 3]);
  assert.equal(bundle.chapters[0].fileName, "TIT_001.mp3");
  assert.equal(bundle.chapters[0].verses.length, 3);
});

test("parseBibleAudioBundle rejects structural and integrity problems", () => {
  rejectsWith(buildBundle({ omitManifest: true }).entries, /bundle\.json/);
  rejectsWith(buildBundle({ manifest: (manifest) => ({ ...manifest, formatVersion: 2 }) }).entries, /formatVersion/);
  rejectsWith(buildBundle({ manifest: (manifest) => ({ ...manifest, versionId: "Bad_ID" }) }).entries, /versionId/);
  rejectsWith(buildBundle({ manifest: (manifest) => ({ ...manifest, book: { code: "XXX", nameZh: "未知", chapterCount: 3 } }) }).entries, /未知的书卷码/);
  rejectsWith(buildBundle({ manifest: (manifest) => ({ ...manifest, book: { code: "TIT", nameZh: "提多书", chapterCount: 4 } }) }).entries, /应有 3 章/);
  rejectsWith(
    buildBundle({ manifest: (manifest) => ({ ...manifest, chapters: (manifest.chapters as Record<string, unknown>[]).slice(0, 2) }) }).entries,
    /只有 2 章/
  );
  rejectsWith(
    buildBundle({
      manifest: (manifest) => {
        const chapters = (manifest.chapters as Record<string, unknown>[]).map((chapter) => ({ ...chapter }));
        chapters[2].chapter = 2;
        return { ...manifest, chapters };
      }
    }).entries,
    /重复|文件路径/
  );
  rejectsWith(buildBundle({ files: (files) => files.set("audio/TIT/TIT_002.mp3", chapterAudio(99)) }).entries, /md5/);
  rejectsWith(buildBundle({ files: (files) => files.set("audio/TIT/TIT_002.mp3", chapterAudio(2, 4096)) }).entries, /大小/);
  rejectsWith(buildBundle({ files: (files) => files.delete("audio/TIT/TIT_003.mp3") }).entries, /缺少 audio\/TIT\/TIT_003\.mp3/);
  rejectsWith(
    buildBundle({
      manifest: (manifest) => {
        const chapters = (manifest.chapters as Record<string, unknown>[]).map((chapter) => ({ ...chapter }));
        chapters[0].verses = [{ verse: 0, startMs: 10, endMs: 5 }];
        return { ...manifest, chapters };
      }
    }).entries,
    /逐节时间戳/
  );
  rejectsWith(
    buildBundle({
      manifest: (manifest) => {
        const chapters = (manifest.chapters as Record<string, unknown>[]).map((chapter) => ({ ...chapter }));
        chapters[0].file = "../../etc/passwd";
        return { ...manifest, chapters };
      }
    }).entries,
    /文件路径应为/
  );
});

test("admin bundle upload stores audio under basename-safe paths and records chapters", async () => {
  const { app, dir, versions, chapters } = await createHarness();
  const { archive } = buildBundle();
  const response = await uploadBundle(app, archive);
  assert.equal(response.statusCode, 201, response.body);
  const payload = response.json();
  assert.equal(payload.success, true);
  assert.equal(payload.book.code, "TIT");
  assert.equal(payload.book.replaced, false);
  assert.equal(payload.version.versionId, "cuvmpt-drama");
  assert.equal(payload.version.bookCount, 1);
  assert.equal(payload.version.chapterCount, 3);
  assert.equal(payload.version.totalBytes, 3 * 2048);
  assert.equal(payload.version.completed, false);
  assert.deepEqual(payload.version.books, ["TIT"]);
  for (const chapter of [1, 2, 3]) {
    const file = path.join(dir, "cuvmpt-drama", "audio", "TIT", `TIT_00${chapter}.mp3`);
    assert.ok(fs.existsSync(file), `${file} should exist`);
    assert.equal(createHash("md5").update(fs.readFileSync(file)).digest("hex"), createHash("md5").update(chapterAudio(chapter)).digest("hex"));
  }
  assert.equal(fs.readdirSync(dir).filter((name) => name.startsWith(".upload-")).length, 0, "temporary upload removed");
  assert.equal(versions.size, 1);
  assert.equal(chapters.size, 3);

  const again = await uploadBundle(app, archive);
  assert.equal(again.statusCode, 201);
  assert.equal(again.json().book.replaced, true);
  assert.equal(chapters.size, 3, "re-upload replaces instead of duplicating");
  assert.equal(versions.size, 1);
});

test("admin bundle upload rejects corrupted bundles without leaving files or rows", async () => {
  const { app, dir, versions, chapters } = await createHarness();
  const { archive } = buildBundle({ files: (files) => files.set("audio/TIT/TIT_001.mp3", chapterAudio(55)) });
  const response = await uploadBundle(app, archive);
  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /md5/);
  assert.equal(versions.size, 0);
  assert.equal(chapters.size, 0);
  assert.ok(!fs.existsSync(path.join(dir, "cuvmpt-drama")));
  assert.equal(fs.readdirSync(dir).length, 0);

  const notZip = await uploadBundle(app, Buffer.from("hello"), "bundle.zip");
  assert.equal(notZip.statusCode, 400);
  const wrongExtension = await uploadBundle(app, buildBundle().archive, "bundle.tar");
  assert.equal(wrongExtension.statusCode, 400);
});

test("bundle upload and settings require an administrator", async () => {
  const { app } = await createHarness("user");
  assert.equal((await uploadBundle(app, buildBundle().archive)).statusCode, 403);
  assert.equal((await app.inject({ method: "POST", url: "/api/admin/bible-audio/settings", payload: { enabled: true } })).statusCode, 403);
  assert.equal((await app.inject({ method: "GET", url: "/api/admin/bible-audio/versions" })).statusCode, 403);
  assert.equal((await app.inject({ method: "DELETE", url: "/api/admin/bible-audio/versions/cuvmpt-drama" })).statusCode, 403);
  const anonymous = await createHarness("anonymous");
  assert.equal((await anonymous.app.inject({ method: "GET", url: "/api/bible-audio/manifest" })).statusCode, 401);
  assert.equal((await anonymous.app.inject({ method: "GET", url: "/api/bible-audio/cuvmpt-drama/TIT/1/stream" })).statusCode, 401);
});

test("manifest reports disabled state and serves cached chapter index with ETag when enabled", async () => {
  const { app, settings } = await createHarness();
  await uploadBundle(app, buildBundle().archive);
  const disabled = await app.inject({ method: "GET", url: "/api/bible-audio/manifest" });
  assert.equal(disabled.statusCode, 200);
  assert.deepEqual(disabled.json(), { enabled: false, defaultVersionId: null, versions: [] });

  settings.set("bibleAudioEnabled", "true");
  settings.set("bibleAudioDefaultVersion", "cuvmpt-drama");
  const enabled = await app.inject({ method: "GET", url: "/api/bible-audio/manifest" });
  assert.equal(enabled.statusCode, 200);
  const manifest = enabled.json();
  assert.equal(manifest.enabled, true);
  assert.equal(manifest.defaultVersionId, "cuvmpt-drama");
  assert.equal(manifest.versions.length, 1);
  assert.equal(manifest.versions[0].chapters.length, 3);
  assert.deepEqual(manifest.versions[0].chapters[0].verses[1], { verse: 1, startMs: 5000, endMs: 15000 });
  const etag = enabled.headers.etag;
  assert.ok(etag);
  const revalidated = await app.inject({ method: "GET", url: "/api/bible-audio/manifest", headers: { "if-none-match": String(etag) } });
  assert.equal(revalidated.statusCode, 304);

  await uploadBundle(app, buildBundle({ manifest: (manifest) => ({ ...manifest, name: "重传后的名称" }) }).archive);
  const refreshed = await app.inject({ method: "GET", url: "/api/bible-audio/manifest", headers: { "if-none-match": String(etag) } });
  assert.equal(refreshed.statusCode, 200, "manifest cache invalidates after upload");
  assert.equal(refreshed.json().versions[0].name, "重传后的名称");
});

test("stream serves full and ranged audio with auth and feature gating", async () => {
  const admin = await createHarness("admin");
  const user = await createHarness("user", admin);
  await uploadBundle(admin.app, buildBundle().archive);

  const gated = await user.app.inject({ method: "GET", url: "/api/bible-audio/cuvmpt-drama/TIT/1/stream" });
  assert.equal(gated.statusCode, 403, "members cannot stream before the feature is enabled");
  const preview = await admin.app.inject({ method: "GET", url: "/api/bible-audio/cuvmpt-drama/TIT/1/stream" });
  assert.equal(preview.statusCode, 200, "administrators may preview before enabling");

  admin.settings.set("bibleAudioEnabled", "true");
  admin.settings.set("bibleAudioDefaultVersion", "cuvmpt-drama");
  const full = await user.app.inject({ method: "GET", url: "/api/bible-audio/cuvmpt-drama/tit/2/stream" });
  assert.equal(full.statusCode, 200);
  assert.equal(full.headers["content-length"], "2048");
  assert.equal(full.headers["accept-ranges"], "bytes");
  assert.equal(full.headers["content-type"], "audio/mpeg");
  assert.equal(full.headers["cache-control"], "private, max-age=3600");
  assert.ok(Buffer.from(full.rawPayload).equals(chapterAudio(2)));

  const partial = await user.app.inject({ method: "GET", url: "/api/bible-audio/cuvmpt-drama/TIT/2/stream", headers: { range: "bytes=100-199" } });
  assert.equal(partial.statusCode, 206);
  assert.equal(partial.headers["content-range"], "bytes 100-199/2048");
  assert.equal(partial.headers["content-length"], "100");
  assert.ok(Buffer.from(partial.rawPayload).equals(chapterAudio(2).subarray(100, 200)));

  const suffix = await user.app.inject({ method: "GET", url: "/api/bible-audio/cuvmpt-drama/TIT/2/stream", headers: { range: "bytes=-48" } });
  assert.equal(suffix.statusCode, 206);
  assert.equal(suffix.headers["content-range"], "bytes 2000-2047/2048");

  const invalidRange = await user.app.inject({ method: "GET", url: "/api/bible-audio/cuvmpt-drama/TIT/2/stream", headers: { range: "bytes=5000-6000" } });
  assert.equal(invalidRange.statusCode, 416);
  assert.equal(invalidRange.headers["content-range"], "bytes */2048");

  const cached = await user.app.inject({ method: "GET", url: "/api/bible-audio/cuvmpt-drama/TIT/2/stream", headers: { "if-none-match": String(full.headers.etag) } });
  assert.equal(cached.statusCode, 304);

  assert.equal((await user.app.inject({ method: "GET", url: "/api/bible-audio/cuvmpt-drama/TIT/9/stream" })).statusCode, 404);
  assert.equal((await user.app.inject({ method: "GET", url: "/api/bible-audio/cuvmpt-drama/GEN/1/stream" })).statusCode, 404);
  assert.equal((await user.app.inject({ method: "GET", url: "/api/bible-audio/other-version/TIT/1/stream" })).statusCode, 404);
  assert.equal((await user.app.inject({ method: "GET", url: "/api/bible-audio/cuvmpt-drama/XXX/1/stream" })).statusCode, 400);
  assert.equal((await user.app.inject({ method: "GET", url: "/api/bible-audio/Bad%20Id/TIT/1/stream" })).statusCode, 400);

  // 每次非 Range 的章节加载记一条「听圣经」（含 304 重验证），Range 分段与 4xx 不记录
  assert.deepEqual(admin.activity.map((entry) => entry.state), ["提多书 1章", "提多书 2章", "提多书 2章"]);
  assert.ok(admin.activity.every((entry) => entry.kind === "bible_listen" && entry.accountId === 7 && entry.sessionId === "sess-7"));
});

test("settings only enable the feature once the default version is complete", async () => {
  const { app, settings, versions } = await createHarness();
  await uploadBundle(app, buildBundle().archive);

  const noDefault = await app.inject({ method: "POST", url: "/api/admin/bible-audio/settings", payload: { enabled: true } });
  assert.equal(noDefault.statusCode, 400);
  assert.match(noDefault.json().message, /默认/);

  const missingVersion = await app.inject({ method: "POST", url: "/api/admin/bible-audio/settings", payload: { defaultVersion: "nope-version" } });
  assert.equal(missingVersion.statusCode, 400);

  const setDefault = await app.inject({ method: "POST", url: "/api/admin/bible-audio/settings", payload: { defaultVersion: "cuvmpt-drama" } });
  assert.equal(setDefault.statusCode, 200);
  assert.deepEqual(setDefault.json().settings, { enabled: false, defaultVersion: "cuvmpt-drama" });

  const incomplete = await app.inject({ method: "POST", url: "/api/admin/bible-audio/settings", payload: { enabled: true } });
  assert.equal(incomplete.statusCode, 400);
  assert.match(incomplete.json().message, /未上传完整/);
  assert.equal(settings.get("bibleAudioEnabled"), "false");

  for (const version of versions.values()) version.completed = true;
  const enabled = await app.inject({ method: "POST", url: "/api/admin/bible-audio/settings", payload: { enabled: true } });
  assert.equal(enabled.statusCode, 200);
  assert.deepEqual(enabled.json().settings, { enabled: true, defaultVersion: "cuvmpt-drama" });
  assert.equal(settings.get("bibleAudioEnabled"), "true");

  const unknownField = await app.inject({ method: "POST", url: "/api/admin/bible-audio/settings", payload: { enabled: true, extra: 1 } });
  assert.equal(unknownField.statusCode, 400);

  const overview = await app.inject({ method: "GET", url: "/api/admin/bible-audio/versions" });
  assert.equal(overview.statusCode, 200);
  assert.equal(overview.json().versions[0].books[0], "TIT");
  assert.deepEqual(overview.json().settings, { enabled: true, defaultVersion: "cuvmpt-drama" });

  const disabled = await app.inject({ method: "POST", url: "/api/admin/bible-audio/settings", payload: { enabled: false } });
  assert.equal(disabled.statusCode, 200);
  assert.equal(settings.get("bibleAudioEnabled"), "false");
});

test("deleting a version removes rows and files and turns the feature off when it was the default", async () => {
  const { app, dir, settings, versions, chapters } = await createHarness();
  await uploadBundle(app, buildBundle().archive);
  for (const version of versions.values()) version.completed = true;
  await app.inject({ method: "POST", url: "/api/admin/bible-audio/settings", payload: { defaultVersion: "cuvmpt-drama", enabled: true } });
  assert.equal(settings.get("bibleAudioEnabled"), "true");

  assert.equal((await app.inject({ method: "DELETE", url: "/api/admin/bible-audio/versions/missing-version" })).statusCode, 404);
  const removed = await app.inject({ method: "DELETE", url: "/api/admin/bible-audio/versions/cuvmpt-drama" });
  assert.equal(removed.statusCode, 200);
  assert.deepEqual(removed.json(), { success: true, settings: { enabled: false, defaultVersion: null }, disabled: true });
  assert.equal(versions.size, 0);
  assert.equal(chapters.size, 0);
  assert.ok(!fs.existsSync(path.join(dir, "cuvmpt-drama")));
  const manifest = await app.inject({ method: "GET", url: "/api/bible-audio/manifest" });
  assert.deepEqual(manifest.json(), { enabled: false, defaultVersionId: null, versions: [] });
});
