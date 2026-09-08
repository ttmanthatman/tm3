import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import webPush from "web-push";
import { z } from "zod";
import { pushOriginFromHeaders } from "../pushOrigin.js";

export type NotificationAuthContext = {
  accountId: number;
  actorId: number;
  username: string;
  isAdmin: boolean;
  canPinMessages: boolean;
  sessionId: string;
};

type AuthedNotificationRequest = FastifyRequest & { auth: NotificationAuthContext };

export type NotificationsRouteDependencies = {
  prisma: PrismaClient;
  requireAuth: preHandlerHookHandler;
  pushNotificationsEnabled: boolean;
  vapidPublicKey(): string;
  pushReady(): boolean;
  canAccessChannel(accountId: number, channelId: number): Promise<boolean>;
};

const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(512),
  keys: z.object({
    p256dh: z.string().min(1).max(255),
    auth: z.string().min(1).max(255)
  })
});

export function registerNotificationsRoutes(app: FastifyInstance, deps: NotificationsRouteDependencies) {
  const { prisma, requireAuth, pushNotificationsEnabled, vapidPublicKey, pushReady, canAccessChannel } = deps;

  app.get("/api/notifications/settings", { preHandler: requireAuth }, async (request) => {
    const auth = (request as AuthedNotificationRequest).auth;
    const origin = pushOriginFromHeaders(request.headers);
    const preferences = await prisma.channelNotificationPreference.findMany({
      where: { accountId: auth.accountId, muted: true },
      select: { channelId: true }
    });
    const subscriptions = pushNotificationsEnabled && origin ? await prisma.pushSubscription.count({ where: { accountId: auth.accountId, origin } }) : 0;
    return {
      enabled: pushNotificationsEnabled,
      publicKey: vapidPublicKey(),
      pushReady: pushReady(),
      subscriptions,
      mutedChannelIds: preferences.map((item) => item.channelId)
    };
  });

  app.post("/api/push-subscriptions", { preHandler: requireAuth }, async (request, reply) => {
    if (!pushNotificationsEnabled) return reply.code(503).send({ success: false, message: "当前环境已关闭消息推送" });
    const auth = (request as AuthedNotificationRequest).auth;
    const origin = pushOriginFromHeaders(request.headers);
    if (!origin) return reply.code(400).send({ success: false, message: "无法识别当前站点来源" });
    const body = pushSubscriptionSchema.parse(request.body);
    await prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      update: {
        accountId: auth.accountId,
        origin,
        keysP256dh: body.keys.p256dh,
        keysAuth: body.keys.auth
      },
      create: {
        accountId: auth.accountId,
        endpoint: body.endpoint,
        origin,
        keysP256dh: body.keys.p256dh,
        keysAuth: body.keys.auth
      }
    });
    return { success: true };
  });

  app.delete("/api/push-subscriptions", { preHandler: requireAuth }, async (request) => {
    const auth = (request as AuthedNotificationRequest).auth;
    const origin = pushOriginFromHeaders(request.headers);
    const body = z.object({ endpoint: z.string().url().max(512).optional() }).parse(request.body || {});
    const where = body.endpoint ? { accountId: auth.accountId, endpoint: body.endpoint, origin } : { accountId: auth.accountId, origin };
    await prisma.pushSubscription.deleteMany({ where });
    return { success: true };
  });

  app.post("/api/notifications/test", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedNotificationRequest).auth;
    if (!pushReady()) return reply.code(400).send({ success: false, message: "服务器推送未就绪" });
    const origin = pushOriginFromHeaders(request.headers);
    if (!origin) return reply.code(400).send({ success: false, message: "无法识别当前站点来源" });
    const body = z.object({ endpoint: z.string().url().max(512).optional() }).parse(request.body || {});
    const subscriptions = await prisma.pushSubscription.findMany({
      where: body.endpoint ? { accountId: auth.accountId, endpoint: body.endpoint, origin } : { accountId: auth.accountId, origin }
    });
    if (!subscriptions.length) return reply.code(404).send({ success: false, message: "当前设备还没有通知订阅" });
    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await webPush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.keysP256dh, auth: subscription.keysAuth }
            },
            JSON.stringify({
              title: "Team Chat 测试通知",
              body: "通知已经可以用啦。以后 @ 和重要公告会从这里提醒你。",
              url: "/",
              tag: `notification-test-${auth.accountId}`,
              channelId: 0
            })
          );
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await prisma.pushSubscription.deleteMany({ where: { endpoint: subscription.endpoint } });
          } else {
            app.log.warn({ error }, "test push notification failed");
            throw error;
          }
        }
      })
    );
    return { success: true, sent: subscriptions.length };
  });

  app.patch("/api/notifications/channels/:id", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthedNotificationRequest).auth;
    const channelId = Number((request.params as { id: string }).id);
    if (!channelId || !(await canAccessChannel(auth.accountId, channelId))) return reply.code(403).send({ success: false, message: "无权访问此频道" });
    const body = z.object({ muted: z.boolean() }).parse(request.body);
    if (body.muted) {
      await prisma.channelNotificationPreference.upsert({
        where: { channelId_accountId: { channelId, accountId: auth.accountId } },
        update: { muted: true },
        create: { channelId, accountId: auth.accountId, muted: true }
      });
    } else {
      await prisma.channelNotificationPreference.deleteMany({ where: { channelId, accountId: auth.accountId } });
    }
    return { success: true, channelId, muted: body.muted };
  });
}

