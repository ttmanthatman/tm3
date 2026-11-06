import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { WallpaperConfig, WallpaperImage, WallpaperPreference } from "../../shared/wallpaper.js";
import { saveImageUpload, type AppearanceService } from "./appearance.js";
import { safeUnlink } from "../storageDirs.js";

const configSchema = z.object({
  wallpaperPath: z.string().max(160), wallpaperFit: z.enum(["cover", "contain", "stretch", "repeat", "pan"]),
  wallpaperPanFocusX: z.number().min(0).max(1), wallpaperPanDirection: z.enum(["left", "right"]), wallpaperPanSpeed: z.number().min(0.02).max(1)
}).strict();
const globalKey = "wallpaper:shared";
const imagePrefix = "wallpaper:image:";
type Shared = { config: WallpaperConfig; version: string; updatedBy: string };
type Request = FastifyRequest & { auth: { accountId: number; isAdmin: boolean; isGuest?: boolean } };
export function registerWallpaperRoutes(app: FastifyInstance, deps: {
  prisma: PrismaClient; requireAuth: (request: FastifyRequest, reply: import("fastify").FastifyReply) => Promise<unknown>; appearance: AppearanceService;
  changed: (accountId?: number) => void;
}) {
  const { prisma, requireAuth, appearance, changed } = deps;
  const requireMember: preHandlerHookHandler = async (request, reply) => {
    await requireAuth(request, reply);
    if (!reply.sent && (request as Request).auth.isGuest) return reply.code(403).send({ message: "请使用成员账号设置壁纸" });
  };
  const prefKey = (id: number) => `wallpaper:account:${id}`;
  async function state(accountId: number) {
    const [rows, sharedRow, prefRow, fallback] = await Promise.all([
      prisma.setting.findMany({ where: { key: { startsWith: imagePrefix } }, orderBy: { updatedAt: "desc" } }),
      prisma.setting.findUnique({ where: { key: globalKey } }), prisma.setting.findUnique({ where: { key: prefKey(accountId) } }), appearance.appearanceDto()
    ]);
    const { wallpaperPath, wallpaperFit, wallpaperPanFocusX, wallpaperPanDirection, wallpaperPanSpeed } = fallback;
    const shared: Shared = sharedRow ? JSON.parse(sharedRow.value) : { config: { wallpaperPath, wallpaperFit: wallpaperFit as WallpaperConfig["wallpaperFit"], wallpaperPanFocusX, wallpaperPanDirection, wallpaperPanSpeed }, version: "legacy", updatedBy: "管理员" };
    const images = rows.map(row => JSON.parse(row.value) as WallpaperImage);
    if (fallback.wallpaperPath && !images.some(image => image.fileName === fallback.wallpaperPath)) images.push({ id: "legacy", fileName: fallback.wallpaperPath, contributorId: 0, contributorName: "管理员", createdAt: "" });
    return { images, shared: shared.config, version: shared.version, updatedBy: shared.updatedBy,
      preference: prefRow ? JSON.parse(prefRow.value) as WallpaperPreference : { mode: "follow" as const } };
  }
  app.get("/api/wallpapers", { preHandler: requireAuth }, request => state((request as Request).auth.accountId));
  app.post("/api/wallpapers", { preHandler: requireMember, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId } = (request as Request).auth;
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId }, select: { displayName: true } });
    const fileName = await saveImageUpload(request, reply, "请选择壁纸图片", false, 15 * 1024 * 1024);
    if (!fileName) return reply;
    const image: WallpaperImage = { id: crypto.randomUUID(), fileName, contributorId: accountId, contributorName: account.displayName, createdAt: new Date().toISOString() };
    try { await prisma.setting.create({ data: { key: imagePrefix + image.id, value: JSON.stringify(image) } }); }
    catch (error) { safeUnlink("background", fileName); throw error; }
    changed();
    return { image };
  });
  app.patch("/api/wallpapers/preference", { preHandler: requireMember }, async (request, reply) => {
    const body = z.object({ mode: z.enum(["follow", "personal", "off"]), config: configSchema.optional() }).strict().parse(request.body);
    const { accountId } = (request as Request).auth;
    if (body.mode === "personal") {
      const current = await state(accountId);
      if (!body.config || !current.images.some(image => image.fileName === body.config?.wallpaperPath && !image.withdrawn && !image.banned)) return reply.code(400).send({ message: "请选择可用壁纸" });
    }
    await appearance.setSetting(prefKey(accountId), JSON.stringify(body.mode === "personal" ? body : { mode: body.mode }));
    changed(accountId);
    return state(accountId);
  });
  app.put("/api/wallpapers/shared", { preHandler: requireMember, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = z.object({ config: configSchema, version: z.string().max(80) }).strict().parse(request.body);
    const { accountId } = (request as Request).auth;
    const current = await state(accountId);
    if (body.version !== current.version) return reply.code(409).send({ message: "大家的壁纸刚刚更新，请查看后再次设置" });
    if (!current.images.some(image => image.fileName === body.config.wallpaperPath && !image.withdrawn && !image.banned)) return reply.code(400).send({ message: "壁纸已撤下，请重新选择" });
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId }, select: { displayName: true } });
    // Initialize once; compare the entire stored value so two simultaneous publishers cannot overwrite each other.
    await prisma.setting.upsert({ where: { key: globalKey }, update: {}, create: { key: globalKey, value: JSON.stringify({ config: current.shared, version: "legacy", updatedBy: current.updatedBy }) } });
    const row = await prisma.setting.findUniqueOrThrow({ where: { key: globalKey } });
    if ((JSON.parse(row.value) as Shared).version !== body.version) return reply.code(409).send({ message: "大家的壁纸刚刚更新，请查看后再次设置" });
    const value = JSON.stringify({ config: body.config, version: crypto.randomUUID(), updatedBy: account.displayName });
    const saved = await prisma.$transaction(async tx => {
      const result = await tx.setting.updateMany({ where: { key: globalKey, value: row.value }, data: { value } });
      if (!result.count) return false;
      await tx.setting.upsert({ where: { key: prefKey(accountId) }, create: { key: prefKey(accountId), value: '{"mode":"follow"}' }, update: { value: '{"mode":"follow"}' } });
      return true;
    });
    if (!saved) return reply.code(409).send({ message: "大家的壁纸刚刚更新，请再次设置" });
    changed();
    return state(accountId);
  });
  app.delete<{ Params: { id: string } }>("/api/wallpapers/:id", { preHandler: requireMember }, async (request, reply) => {
    const { accountId, isAdmin } = (request as Request).auth;
    const id = z.string().uuid().parse(request.params.id);
    const row = await prisma.setting.findUnique({ where: { key: imagePrefix + id } });
    if (!row) return reply.code(404).send({ message: "壁纸不存在" });
    const image = JSON.parse(row.value) as WallpaperImage;
    if (image.contributorId !== accountId && !isAdmin) return reply.code(403).send({ message: "只能撤下自己贡献的壁纸" });
    await appearance.setSetting(row.key, JSON.stringify({ ...image, withdrawn: true, banned: isAdmin }));
    changed();
    return { success: true };
  });
}
