import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { Prisma, type Account, type AccountSession, type Actor, type PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { AdminLoginLogKind } from "../../shared/types.js";
import { cleanBibleWorkspaceState } from "../bible/workspaceState.js";
import { biblePreferencesJson } from "../biblePreferences.js";
import { cleanThemeId } from "./appearance.js";

export type AuthRouteAuthContext = {
  accountId: number;
  actorId: number;
  username: string;
  isAdmin: boolean;
  canPinMessages: boolean;
  sessionId: string;
};

type AuthedAuthRequest = FastifyRequest & { auth: AuthRouteAuthContext };
type AccountWithActor = Account & { actor: Actor | null };
type LoginLogSession = Pick<AccountSession, "id" | "deviceKind" | "deviceName" | "ipAddress" | "userAgent">;

export type AuthRouteDependencies = {
  prisma: PrismaClient;
  requireAuth: preHandlerHookHandler;
  authLoginRateLimitMax: number;
  settingBool(key: string, fallback?: boolean): Promise<boolean>;
  themeExists(theme: string): Promise<boolean>;
  signToken(account: AccountWithActor, session: Pick<AccountSession, "id">): string;
  authDto(account: AccountWithActor): unknown;
  createAuthSession(accountId: number, request: FastifyRequest, deviceNameOverride?: string, appVersion?: string): Promise<Pick<AccountSession, "id">>;
  sessionExpiresAt(now?: Date): Date;
  writeLoginLog(kind: AdminLoginLogKind, accountId: number, session?: LoginLogSession | null, createdAt?: Date): Promise<unknown>;
  disconnectSessions(sessionIds: string[]): void;
  refreshAccountConnections(account: AccountWithActor): void;
  updateAccountAvatarFromUpload(accountId: number, request: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  deleteOwnedReceptionRooms(accountId: number): Promise<unknown>;
};

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDependencies) {
  const {
    prisma,
    requireAuth,
    authLoginRateLimitMax,
    settingBool,
    themeExists,
    signToken,
    authDto,
    createAuthSession,
    sessionExpiresAt,
    writeLoginLog,
    disconnectSessions,
    refreshAccountConnections,
    updateAccountAvatarFromUpload,
    deleteOwnedReceptionRooms
  } = deps;

  app.post("/api/auth/login", { config: { rateLimit: { max: authLoginRateLimitMax, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = z.object({ username: z.string().min(1).max(40), password: z.string().min(1).max(128), deviceName: z.string().max(120).optional(), appVersion: z.string().max(32).optional() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ success: false, message: "参数错误" });
    const account = await prisma.account.findUnique({ where: { username: body.data.username }, include: { actor: true } });
    if (!account || account.isGuest || !(await bcrypt.compare(body.data.password, account.passwordHash))) {
      return reply.code(401).send({ success: false, message: "用户名或密码错误" });
    }
    const session = await createAuthSession(account.id, request, body.data.deviceName, body.data.appVersion);
    const updated = await prisma.account.findUniqueOrThrow({ where: { id: account.id }, include: { actor: true } });
    return { success: true, token: signToken(updated, session), account: authDto(updated) };
  });

  app.post("/api/auth/register", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const enabled = await settingBool("registrationEnabled", false);
    if (!enabled) return reply.code(403).send({ success: false, message: "暂未开放注册" });
    const body = z
      .object({
        username: z.string().regex(/^[a-zA-Z0-9_.-]{2,40}$/),
        displayName: z.string().min(1).max(80),
        password: z.string().min(10).max(128),
        deviceName: z.string().max(120).optional(),
        appVersion: z.string().max(32).optional()
      })
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ success: false, message: "用户名需 2-40 位，密码需 10-128 位" });
    const existing = await prisma.account.findUnique({ where: { username: body.data.username }, select: { id: true } });
    if (existing) return reply.code(409).send({ success: false, message: "用户名已存在" });
    const account = await prisma.account.create({
      data: {
        username: body.data.username,
        passwordHash: await bcrypt.hash(body.data.password, 12),
        displayName: body.data.displayName,
        role: "user",
        actor: { create: { kind: "human", username: body.data.username, displayName: body.data.displayName } }
      },
      include: { actor: true }
    });
    const publicChannels = await prisma.channel.findMany({ where: { isPrivate: false }, select: { id: true } });
    if (publicChannels.length) {
      await prisma.channelMember.createMany({
        data: publicChannels.map((channel) => ({ accountId: account.id, channelId: channel.id, role: "member" })),
        skipDuplicates: true
      });
    }
    const session = await createAuthSession(account.id, request, body.data.deviceName, body.data.appVersion);
    return { success: true, token: signToken(account, session), account: authDto(account) };
  });

  app.get("/api/auth/me", { preHandler: requireAuth }, async (request) => {
    const auth = (request as AuthedAuthRequest).auth;
    const [account, session] = await Promise.all([
      prisma.account.findUniqueOrThrow({ where: { id: auth.accountId }, include: { actor: true } }),
      prisma.accountSession.update({ where: { id: auth.sessionId }, data: { expiresAt: sessionExpiresAt(), lastSeenAt: new Date() }, select: { id: true } })
    ]);
    return { account: authDto(account), token: signToken(account, session) };
  });

  app.patch("/api/me/profile", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedAuthRequest).auth;
    const body = z.object({ displayName: z.string().trim().min(1).max(80) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ success: false, message: "昵称需为 1-80 个字符" });
    const updated = await prisma.account.update({
      where: { id: auth.accountId },
      data: {
        displayName: body.data.displayName,
        actor: { update: { displayName: body.data.displayName } }
      },
      include: { actor: true }
    });
    refreshAccountConnections(updated);
    return { success: true, account: authDto(updated) };
  });

  app.post("/api/me/avatar", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedAuthRequest).auth;
    return updateAccountAvatarFromUpload(auth.accountId, request, reply);
  });

  app.post("/api/auth/change-password", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedAuthRequest).auth;
    const body = z.object({ oldPassword: z.string().max(128), newPassword: z.string().min(10).max(128) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ success: false, message: "新密码需 10-128 位" });
    const account = await prisma.account.findUniqueOrThrow({ where: { id: auth.accountId } });
    if (!(await bcrypt.compare(body.data.oldPassword, account.passwordHash))) return reply.code(400).send({ success: false, message: "原密码错误" });
    await prisma.account.update({ where: { id: auth.accountId }, data: { passwordHash: await bcrypt.hash(body.data.newPassword, 12) } });
    const sessionsToRevoke = await prisma.accountSession.findMany({
      where: { accountId: auth.accountId, id: { not: auth.sessionId }, revokedAt: null },
      select: { id: true, deviceKind: true, deviceName: true, ipAddress: true, userAgent: true }
    });
    const revokedAt = new Date();
    await prisma.accountSession.updateMany({ where: { id: { in: sessionsToRevoke.map((session) => session.id) } }, data: { revokedAt } });
    await Promise.all(sessionsToRevoke.map((session) => writeLoginLog("session_revoked", auth.accountId, session, revokedAt)));
    disconnectSessions(sessionsToRevoke.map((session) => session.id));
    return { success: true };
  });

  app.delete("/api/me/account", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedAuthRequest).auth;
    const body = z.object({ password: z.string().min(1).max(128) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ success: false, message: "请输入当前密码" });
    const account = await prisma.account.findUnique({ where: { id: auth.accountId }, include: { actor: true } });
    if (!account) return reply.code(404).send({ success: false, message: "账号不存在" });
    if (!(await bcrypt.compare(body.data.password, account.passwordHash))) {
      return reply.code(400).send({ success: false, message: "当前密码错误" });
    }
    if (account.role === "admin") {
      const otherAdmins = await prisma.account.count({ where: { role: "admin", id: { not: account.id } } });
      if (!otherAdmins) return reply.code(400).send({ success: false, message: "至少需要保留一个管理员" });
    }
    await deleteOwnedReceptionRooms(account.id);
    const sessions = await prisma.accountSession.findMany({ where: { accountId: account.id }, select: { id: true } });
    await prisma.$transaction(async (tx) => {
      if (account.actor) {
        await tx.actor.update({
          where: { id: account.actor.id },
          data: {
            accountId: null,
            username: `deleted-${account.id}-${crypto.randomUUID()}`,
            displayName: "已注销用户",
            avatarPath: null,
            status: "deleted"
          }
        });
      }
      await tx.account.delete({ where: { id: account.id } });
    });
    disconnectSessions(sessions.map((session) => session.id));
    return { success: true };
  });

  app.post("/api/auth/logout", { preHandler: requireAuth }, async (request) => {
    const auth = (request as AuthedAuthRequest).auth;
    const session = await prisma.accountSession.findFirst({
      where: { id: auth.sessionId, accountId: auth.accountId },
      select: { id: true, deviceKind: true, deviceName: true, ipAddress: true, userAgent: true }
    });
    const now = new Date();
    await prisma.accountSession.updateMany({ where: { id: auth.sessionId, accountId: auth.accountId }, data: { revokedAt: now } });
    await writeLoginLog("auth_logout", auth.accountId, session, now);
    disconnectSessions([auth.sessionId]);
    return { success: true };
  });

  app.get("/api/me/sessions", { preHandler: requireAuth }, async (request) => {
    const auth = (request as AuthedAuthRequest).auth;
    const sessions = await prisma.accountSession.findMany({
      where: { accountId: auth.accountId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: [{ deviceKind: "asc" }, { lastSeenAt: "desc" }]
    });
    return {
      sessions: sessions.map((session) => ({
        id: session.id,
        deviceKind: session.deviceKind,
        deviceName: session.deviceName,
        ipAddress: session.ipAddress,
        createdAt: session.createdAt.toISOString(),
        lastSeenAt: session.lastSeenAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
        current: session.id === auth.sessionId
      }))
    };
  });

  app.delete("/api/me/sessions/:id", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedAuthRequest).auth;
    const sessionId = (request.params as { id: string }).id;
    const session = await prisma.accountSession.findFirst({
      where: { id: sessionId, accountId: auth.accountId, revokedAt: null },
      select: { id: true, deviceKind: true, deviceName: true, ipAddress: true, userAgent: true }
    });
    const now = new Date();
    const result = await prisma.accountSession.updateMany({
      where: { id: sessionId, accountId: auth.accountId, revokedAt: null },
      data: { revokedAt: now }
    });
    if (!result.count) return reply.code(404).send({ success: false, message: "设备不存在" });
    await writeLoginLog("session_revoked", auth.accountId, session, now);
    disconnectSessions([sessionId]);
    return { success: true, current: sessionId === auth.sessionId };
  });

  app.patch("/api/me/preferences", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedAuthRequest).auth;
    const body = z
      .object({
        theme: z.string().optional(),
        biblePreferences: z
          .object({
            outputFormat: z.string().optional(),
            referenceLabelMode: z.string().optional(),
            combinedPassageMode: z.string().optional(),
            quotationStyle: z.string().optional()
          })
          .optional(),
        bibleWorkspace: z.unknown().nullable().optional()
      })
      .parse(request.body);
    const data: Prisma.AccountUpdateInput = {};
    if (body.theme !== undefined) {
      const requestedTheme = cleanThemeId(body.theme);
      data.theme = requestedTheme && (await themeExists(requestedTheme)) ? requestedTheme : "wechat";
    }
    if (body.biblePreferences !== undefined || body.bibleWorkspace !== undefined) {
      const current = await prisma.account.findUnique({ where: { id: auth.accountId }, select: { biblePreferences: true } });
      const merged: Record<string, unknown> = {
        ...(current?.biblePreferences as Record<string, unknown> | null | undefined),
        ...body.biblePreferences
      };
      if (body.bibleWorkspace !== undefined) {
        if (body.bibleWorkspace === null) delete merged.workspace;
        else {
          const workspace = cleanBibleWorkspaceState(body.bibleWorkspace);
          if (!workspace) return reply.code(400).send({ success: false, message: "阅读窗格状态格式无效" });
          merged.workspace = workspace;
        }
      }
      data.biblePreferences = biblePreferencesJson(merged);
    }
    const account = Object.keys(data).length
      ? await prisma.account.update({ where: { id: auth.accountId }, data, include: { actor: true } })
      : await prisma.account.findUniqueOrThrow({ where: { id: auth.accountId }, include: { actor: true } });
    return { success: true, account: authDto(account) };
  });
}

