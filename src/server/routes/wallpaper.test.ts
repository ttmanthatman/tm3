import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { registerWallpaperRoutes } from "./wallpaper.js";
import { createAppearanceService } from "./appearance.js";
import { defaultWallpaper, effectiveWallpaper } from "../../shared/wallpaper.js";
import { updateWallpaperFileReferences } from "../wallpaperFiles.js";

const id = "cf5ed8d4-fdbc-4133-8d0d-57c3fb3ea513";
test("wallpaper members, personal isolation, conflict detection and withdrawal", async () => {
  const rows = new Map<string, string>([[`wallpaper:image:${id}`, JSON.stringify({ id, fileName: "garden.webp", contributorId: 1, contributorName: "小王", createdAt: "2026-11-06" })]]);
  type Where = { key: string; value?: string };
  const setting = {
    findMany: async ({ where }: { where?: { key?: { startsWith?: string; in?: string[] } } } = {}) => [...rows].filter(([key]) => !where?.key || (where.key.startsWith ? key.startsWith(where.key.startsWith) : where.key.in?.includes(key))).map(([key, value]) => ({ key, value })),
    findUnique: async ({ where }: { where: Where }) => rows.has(where.key) ? { key: where.key, value: rows.get(where.key)! } : null,
    findUniqueOrThrow: async ({ where }: { where: Where }) => { if (!rows.has(where.key)) throw new Error("missing row"); return { key: where.key, value: rows.get(where.key)! }; },
    upsert: async ({ where, update, create }: { where: Where; update: { value?: string }; create: { value: string } }) => { const value = rows.has(where.key) ? update.value ?? rows.get(where.key)! : create.value; rows.set(where.key, value); return { key: where.key, value }; },
    update: async ({ where, data }: { where: Where; data: { value: string } }) => { rows.set(where.key, data.value); },
    updateMany: async ({ where, data }: { where: Where; data: { value: string } }) => { if (rows.get(where.key) !== where.value) return { count: 0 }; rows.set(where.key, data.value); return { count: 1 }; }
  };
  const fake = { setting, account: { findUniqueOrThrow: async () => ({ displayName: "小王" }) }, $transaction: async <T>(fn: (tx: { setting: typeof setting }) => Promise<T>) => fn({ setting }) };
  const prisma = fake as unknown as PrismaClient;
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => { if (error instanceof z.ZodError) return reply.code(400).send({ message: "invalid" }); return reply.send(error); });
  const events: Array<number | undefined> = [];
  registerWallpaperRoutes(app, { prisma, appearance: createAppearanceService({ prisma }), requireAuth: async (request, reply) => {
    if (!request.headers.authorization) { reply.code(401).send({ message: "login" }); return; }
    Object.assign(request, { auth: { accountId: Number(request.headers.authorization), isAdmin: request.headers.authorization === "3", isGuest: request.headers.authorization === "4" } });
  }, changed: accountId => { events.push(accountId); } });
  const get = async (account = "1") => (await app.inject({ url: "/api/wallpapers", headers: { authorization: account } })).json();
  const send = (url: string, method: "PATCH" | "PUT" | "DELETE", payload: Record<string, unknown> | undefined, account = "1") => app.inject({ url, method, payload, headers: { authorization: account } });
  const config = { ...defaultWallpaper, wallpaperPath: "garden.webp", wallpaperFit: "pan" as const };
  try {
    assert.equal((await app.inject({ url: "/api/wallpapers" })).statusCode, 401);
    assert.equal((await send("/api/wallpapers/preference", "PATCH", { mode: "off" }, "4")).statusCode, 403);
    assert.equal((await get()).preference.mode, "follow");
    assert.deepEqual((await get()).shared, defaultWallpaper);
    assert.equal((await send("/api/wallpapers/preference", "PATCH", { mode: "personal", config: { ...config, wallpaperPath: "../private.png" } })).statusCode, 400);
    assert.equal((await send("/api/wallpapers/preference", "PATCH", { mode: "personal", config: { ...config, wallpaperPanSpeed: 9 } })).statusCode, 400);
    assert.equal((await send("/api/wallpapers/preference", "PATCH", { mode: "personal", config })).statusCode, 200);
    assert.equal(events.at(-1), 1);
    const personal = await get(); assert.deepEqual(personal.preference.config, config);
    const sharedSave = await send("/api/wallpapers/shared", "PUT", { version: "legacy", config }, "2"); assert.equal(sharedSave.statusCode, 200);
    assert.equal((await get("2")).preference.mode, "follow");
    assert.equal((await get()).preference.mode, "personal");
    assert.equal((await send("/api/wallpapers/shared", "PUT", { version: "legacy", config })).statusCode, 409);
    const version = (await get()).version;
    const concurrent = await Promise.all([send("/api/wallpapers/shared", "PUT", { version, config }), send("/api/wallpapers/shared", "PUT", { version, config }, "2")]);
    assert.deepEqual(concurrent.map(result => result.statusCode).sort(), [200, 409]);
    assert.equal((await send("/api/wallpapers/preference", "PATCH", { mode: "off" })).statusCode, 200);
    assert.equal(effectiveWallpaper(await get(), config).wallpaperPath, null);
    assert.equal((await send("/api/wallpapers/preference", "PATCH", { mode: "follow" })).statusCode, 200);
    assert.equal(effectiveWallpaper(await get(), defaultWallpaper).wallpaperPath, config.wallpaperPath);
    assert.equal((await send(`/api/wallpapers/${id}`, "DELETE", undefined, "2")).statusCode, 403);
    assert.equal((await send(`/api/wallpapers/${id}`, "DELETE", undefined)).statusCode, 200);
    assert.equal(effectiveWallpaper(await get(), defaultWallpaper).wallpaperPath, config.wallpaperPath);
    assert.equal((await send("/api/wallpapers/preference", "PATCH", { mode: "personal", config }, "2")).statusCode, 400);
    assert.equal((await send(`/api/wallpapers/${id}`, "DELETE", undefined, "3")).statusCode, 200);
    assert.equal(effectiveWallpaper(await get(), config).wallpaperPath, null);
    await updateWallpaperFileReferences(prisma, "garden.webp", "garden-small.webp");
    assert.equal((await get()).shared.wallpaperPath, "garden-small.webp");
    await updateWallpaperFileReferences(prisma, "garden-small.webp", null);
    assert.equal((await get()).shared.wallpaperPath, null);
  } finally { await app.close(); }
});
