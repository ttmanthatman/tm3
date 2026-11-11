import { Prisma, type PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import {
  calendarInputSchema,
  occurrenceStarts,
  type CalendarInput
} from "../../shared/calendar.js";
import { calendarActor, calendarRoleKey } from "../services/calendar.js";
import { virtualCharacterVisibleInChannel } from "../channelMembership.js";

type Auth = { accountId: number; actorId: number; isGuest?: boolean; isAdmin: boolean };
interface Deps {
  prisma: PrismaClient;
  requireAuth: preHandlerHookHandler;
  canAccessChannel(accountId: number, channelId: number): Promise<boolean>;
  canWriteChannel(accountId: number, channelId: number): Promise<boolean>;
  canManageChannel(accountId: number, channelId: number): Promise<boolean>;
  polish(prompt: string, text: string): Promise<string>;
}
const ids = z.object({
  channelId: z.coerce.number().int().positive(),
  id: z.coerce.number().int().positive().optional()
});
const authFor = (req: FastifyRequest) => (req as FastifyRequest & { auth: Auth }).auth;
const visible = (owner: number) => ({
  OR: [
    { ownerAccountId: owner },
    { visibility: "group" },
    { visibility: "members", grants: { some: { accountId: owner } } }
  ]
});
function eventData(value: CalendarInput) {
  const { memberIds, publicReminderConfirmed, ...data } = value;
  return {
    ...data,
    startAt: new Date(value.startAt),
    endAt: new Date(value.endAt),
    untilAt: value.untilAt ? new Date(value.untilAt) : null,
    chainConfig: value.chainConfig ? (value.chainConfig as Prisma.InputJsonValue) : Prisma.JsonNull
  };
}
export function registerCalendarRoutes(app: FastifyInstance, deps: Deps) {
  const { prisma } = deps;
  async function scope(req: FastifyRequest) {
    const parsed = ids.safeParse(req.params);
    if (!parsed.success || authFor(req).isGuest) return null;
    const auth = authFor(req),
      { channelId, id } = parsed.data;
    const channel = await prisma.channel.findUnique({ where: { id: channelId } });
    if (
      !channel ||
      channel.kind !== "standard" ||
      channel.directKey ||
      !(await deps.canAccessChannel(auth.accountId, channelId))
    )
      return null;
    return {
      auth,
      channel,
      channelId,
      id,
      manager: await deps.canManageChannel(auth.accountId, channelId)
    };
  }
  async function allowedMembers(channelId: number, memberIds: number[]) {
    const accounts = await prisma.account.findMany({
      where: { id: { in: memberIds }, isGuest: false },
      select: { id: true }
    });
    return (
      accounts.length === new Set(memberIds).size &&
      (await Promise.all(accounts.map((a) => deps.canAccessChannel(a.id, channelId)))).every(
        Boolean
      )
    );
  }
  app.get(
    "/api/channels/:channelId/calendar",
    { preHandler: deps.requireAuth },
    async (req, reply) => {
      const ctx = await scope(req);
      if (!ctx) return reply.code(404).send({ message: "群日历不存在" });
      const query = z
        .object({
          from: z.string().datetime(),
          to: z.string().datetime(),
          manage: z.enum(["true", "false"]).optional()
        })
        .safeParse(req.query);
      if (
        !query.success ||
        Date.parse(query.data.to) <= Date.parse(query.data.from) ||
        Date.parse(query.data.to) - Date.parse(query.data.from) > 93 * 86400000
      )
        return reply.code(400).send({ message: "请选择不超过三个月的日期范围" });
      const manage = ctx.manager && query.data.manage === "true";
      const rows = await prisma.calendarEvent.findMany({
        where: { channelId: ctx.channelId, ...(manage ? {} : visible(ctx.auth.accountId)) },
        include: { grants: true, owner: { select: { displayName: true } } },
        orderBy: { startAt: "asc" }
      });
      const events = rows.flatMap((event) => {
        const duration = event.endAt.getTime() - event.startAt.getTime();
        return occurrenceStarts(
          event,
          new Date(Date.parse(query.data.from) - duration),
          new Date(query.data.to)
        )
          .filter((at) => at.getTime() + duration >= Date.parse(query.data.from))
          .map((at) => ({
            ...event,
            grants: undefined,
            owner: undefined,
            excludedDates: undefined,
            startAt: event.startAt.toISOString(),
            endAt: event.endAt.toISOString(),
            untilAt: event.untilAt?.toISOString() ?? null,
            occurrenceAt: at.toISOString(),
            occurrenceEndAt: new Date(at.getTime() + duration).toISOString(),
            memberIds: event.grants.map((g) => g.accountId),
            ownerName: event.owner.displayName,
            canManage: ctx.manager || event.ownerAccountId === ctx.auth.accountId,
            publicReminderConfirmed: true
          }));
      });
      const [accounts, roles, identity] = await Promise.all([
        prisma.account.findMany({
          where: { isGuest: false },
          select: { id: true, displayName: true }
        }),
        ctx.manager
          ? prisma.virtualCharacter.findMany({
              where: { enabled: true, actor: { status: "active" } },
              include: { actor: true }
            })
          : Promise.resolve([]),
        calendarActor(prisma, ctx.channelId)
      ]);
      const members = (
        await Promise.all(
          accounts.map(async (a) => ((await deps.canAccessChannel(a.id, ctx.channelId)) ? a : null))
        )
      ).filter(Boolean);
      return {
        events,
        members,
        manager: ctx.manager,
        canCreate: await deps.canWriteChannel(ctx.auth.accountId, ctx.channelId),
        roles: roles
          .filter((r) =>
            virtualCharacterVisibleInChannel(ctx.channel, {
              username: r.actor.username,
              config: r.config
            })
          )
          .map((r) => ({ id: r.actorId, name: r.actor.displayName })),
        role: {
          id: identity.actor.kind === "system" ? null : identity.actor.id,
          name: identity.actor.displayName,
          fallback: identity.fallback
        }
      };
    }
  );
  app.post(
    "/api/channels/:channelId/calendar",
    { preHandler: deps.requireAuth },
    async (req, reply) => {
      const ctx = await scope(req),
        parsed = calendarInputSchema.safeParse(req.body);
      if (!ctx) return reply.code(404).send({ message: "群日历不存在" });
      if (!(await deps.canWriteChannel(ctx.auth.accountId, ctx.channelId)))
        return reply.code(403).send({ message: "当前账号不能添加日程" });
      if (!parsed.success) return reply.code(400).send({ message: parsed.error.issues[0].message });
      if (!(await allowedMembers(ctx.channelId, parsed.data.memberIds)))
        return reply.code(400).send({ message: "可见成员必须属于当前群" });
      const event = await prisma.calendarEvent.create({
        data: {
          ...eventData(parsed.data),
          channelId: ctx.channelId,
          ownerAccountId: ctx.auth.accountId,
          ownerActorId: ctx.auth.actorId,
          excludedDates: [],
          grants: {
            create: [...new Set(parsed.data.memberIds)].map((accountId) => ({ accountId }))
          }
        }
      });
      return { id: event.id };
    }
  );
  app.put(
    "/api/channels/:channelId/calendar/:id",
    { preHandler: deps.requireAuth },
    async (req, reply) => {
      const ctx = await scope(req);
      if (!ctx) return reply.code(404).send({ message: "日程不存在" });
      const body = z
        .object({
          value: calendarInputSchema,
          revision: z.number().int().positive(),
          scope: z.enum(["all", "one", "future"]).default("all"),
          occurrenceAt: z.string().datetime().optional()
        })
        .safeParse(req.body);
      if (!body.success) return reply.code(400).send({ message: body.error.issues[0].message });
      const event = await prisma.calendarEvent.findFirst({
        where: { id: ctx.id, channelId: ctx.channelId }
      });
      if (!event) return reply.code(404).send({ message: "日程不存在" });
      if (!ctx.manager && event.ownerAccountId !== ctx.auth.accountId)
        return reply.code(403).send({ message: "只能管理自己的日程" });
      if (!(await allowedMembers(ctx.channelId, body.data.value.memberIds)))
        return reply.code(400).send({ message: "可见成员必须属于当前群" });
      const { value, revision, scope: editScope, occurrenceAt } = body.data;
      if (
        editScope !== "all" &&
        (!occurrenceAt ||
          !occurrenceStarts(event, new Date(occurrenceAt), new Date(Date.parse(occurrenceAt) + 1))
            .length)
      )
        return reply.code(400).send({ message: "日程发生时间无效" });
      const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.calendarEvent.updateMany({
          where: { id: event.id, revision },
          data: { revision: { increment: 1 } }
        });
        if (!updated.count) return false;
        await tx.calendarNotice.deleteMany({
          where: { delivery: { eventId: event.id }, readAt: null }
        });
        if (editScope === "all" || event.repeat === "none") {
          await tx.calendarEvent.update({
            where: { id: event.id },
            data: {
              ...eventData(value),
              grants: {
                deleteMany: {},
                create: [...new Set(value.memberIds)].map((accountId) => ({ accountId }))
              }
            }
          });
        } else {
          await tx.calendarEvent.update({
            where: { id: event.id },
            data:
              editScope === "one"
                ? {
                    excludedDates: [
                      ...(Array.isArray(event.excludedDates) ? event.excludedDates : []),
                      occurrenceAt!
                    ]
                  }
                : { untilAt: new Date(Date.parse(occurrenceAt!) - 1) }
          });
          await tx.calendarEvent.create({
            data: {
              ...eventData(value),
              ...(editScope === "one" ? { repeat: "none", untilAt: null } : {}),
              channelId: event.channelId,
              ownerAccountId: event.ownerAccountId,
              ownerActorId: event.ownerActorId,
              excludedDates: [],
              grants: { create: [...new Set(value.memberIds)].map((accountId) => ({ accountId })) }
            }
          });
        }
        await tx.auditLog.create({
          data: {
            accountId: ctx.auth.accountId,
            action: "calendar.update",
            target: String(event.id),
            payload: { ownerAccountId: event.ownerAccountId, scope: editScope }
          }
        });
        return true;
      });
      if (!result) return reply.code(409).send({ message: "日程已被修改，请刷新后重试" });
      return { success: true };
    }
  );
  app.delete(
    "/api/channels/:channelId/calendar/:id",
    { preHandler: deps.requireAuth },
    async (req, reply) => {
      const ctx = await scope(req);
      if (!ctx) return reply.code(404).send({ message: "日程不存在" });
      const body = z
        .object({
          revision: z.number().int().positive(),
          scope: z.enum(["all", "one", "future"]).default("all"),
          occurrenceAt: z.string().datetime().optional()
        })
        .safeParse(req.body);
      if (!body.success) return reply.code(400).send({ message: "删除参数无效" });
      const event = await prisma.calendarEvent.findFirst({
        where: { id: ctx.id, channelId: ctx.channelId }
      });
      if (!event) return reply.code(404).send({ message: "日程不存在" });
      if (!ctx.manager && event.ownerAccountId !== ctx.auth.accountId)
        return reply.code(403).send({ message: "只能管理自己的日程" });
      const { revision, scope: editScope, occurrenceAt } = body.data;
      if (
        editScope !== "all" &&
        (!occurrenceAt ||
          !occurrenceStarts(event, new Date(occurrenceAt), new Date(Date.parse(occurrenceAt) + 1))
            .length)
      )
        return reply.code(400).send({ message: "日程发生时间无效" });
      const result = await prisma.$transaction(async (tx) => {
        const locked = await tx.calendarEvent.updateMany({
          where: { id: event.id, revision },
          data: { revision: { increment: 1 } }
        });
        if (!locked.count) return false;
        if (editScope === "all" || event.repeat === "none")
          await tx.calendarEvent.delete({ where: { id: event.id } });
        else {
          await tx.calendarEvent.update({
            where: { id: event.id },
            data:
              editScope === "one"
                ? {
                    excludedDates: [
                      ...(Array.isArray(event.excludedDates) ? event.excludedDates : []),
                      occurrenceAt!
                    ]
                  }
                : { untilAt: new Date(Date.parse(occurrenceAt!) - 1) }
          });
          await tx.calendarNotice.deleteMany({
            where: { delivery: { eventId: event.id }, readAt: null }
          });
        }
        await tx.auditLog.create({
          data: {
            accountId: ctx.auth.accountId,
            action: "calendar.delete",
            target: String(event.id),
            payload: { ownerAccountId: event.ownerAccountId, scope: editScope }
          }
        });
        return true;
      });
      if (!result) return reply.code(409).send({ message: "日程已被修改，请刷新后重试" });
      return { success: true };
    }
  );
  app.put(
    "/api/channels/:channelId/calendar-role",
    { preHandler: deps.requireAuth },
    async (req, reply) => {
      const ctx = await scope(req),
        body = z.object({ actorId: z.number().int().positive().nullable() }).safeParse(req.body);
      if (!ctx || !ctx.manager)
        return reply.code(403).send({ message: "只有群管理员可以指定提醒角色" });
      if (!body.success) return reply.code(400).send({ message: "角色参数无效" });
      if (body.data.actorId) {
        const actor = await prisma.actor.findUnique({
          where: { id: body.data.actorId },
          include: { character: true }
        });
        if (
          !actor?.character?.enabled ||
          actor.status !== "active" ||
          !virtualCharacterVisibleInChannel(ctx.channel, {
            username: actor.username,
            config: actor.character.config
          })
        )
          return reply.code(400).send({ message: "该角色不可用于本群" });
      }
      const key = calendarRoleKey(ctx.channelId),
        value = String(body.data.actorId || "");
      await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
      return { success: true };
    }
  );
  app.post(
    "/api/channels/:channelId/calendar-preview",
    { preHandler: deps.requireAuth },
    async (req, reply) => {
      const ctx = await scope(req),
        body = z.object({ text: z.string().trim().min(1).max(3000) }).safeParse(req.body);
      if (!ctx || !(await deps.canWriteChannel(ctx.auth.accountId, ctx.channelId)))
        return reply.code(403).send({ message: "无权生成提醒" });
      if (!body.success) return reply.code(400).send({ message: "请填写公开提醒正文" });
      const { actor } = await calendarActor(prisma, ctx.channelId);
      if (actor.kind === "system") return { text: body.data.text, fallback: false };
      const character = await prisma.virtualCharacter.findUnique({ where: { actorId: actor.id } });
      try {
        return {
          text: (await deps.polish(JSON.stringify(character?.config), body.data.text)).slice(
            0,
            3000
          ),
          fallback: false
        };
      } catch (error) {
        req.log.warn({ error }, "calendar preview unavailable");
        return { text: body.data.text, fallback: true };
      }
    }
  );
  app.get("/api/calendar/notices", { preHandler: deps.requireAuth }, async (req) => {
    const auth = authFor(req);
    if (auth.isGuest) return { notices: [] };
    const rows = await prisma.calendarNotice.findMany({
      where: { accountId: auth.accountId, readAt: null, delivery: { event: { paused: false } } },
      include: { delivery: { include: { event: true } } },
      orderBy: { id: "asc" },
      take: 100
    });
    const notices = [];
    for (const row of rows) {
      const event = row.delivery.event;
      if (
        event.revision !== row.delivery.revision ||
        !(await deps.canAccessChannel(auth.accountId, event.channelId))
      )
        continue;
      notices.push({
        id: row.id,
        eventId: event.id,
        channelId: event.channelId,
        title: event.title,
        description: event.description,
        occurrenceAt: row.delivery.occurrenceAt.toISOString(),
        allDay: event.allDay,
        timeZone: event.timeZone
      });
    }
    return { notices };
  });
  app.post("/api/calendar/notices/read", { preHandler: deps.requireAuth }, async (req, reply) => {
    const body = z
      .object({ ids: z.array(z.number().int().positive()).min(1).max(100) })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ message: "提醒参数无效" });
    await prisma.calendarNotice.updateMany({
      where: { id: { in: body.data.ids }, accountId: authFor(req).accountId, readAt: null },
      data: { readAt: new Date() }
    });
    return { success: true };
  });
}
