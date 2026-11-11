import { Prisma, type CalendarEvent, type PrismaClient } from "@prisma/client";
import { occurrenceStarts } from "../../shared/calendar.js";
import { virtualCharacterVisibleInChannel } from "../channelMembership.js";
import { createChainPayload } from "./chainService.js";

export const calendarRoleKey = (channelId: number) => `calendar:role:${channelId}`;
export async function calendarActor(prisma: PrismaClient, channelId: number) {
  const [setting, channel] = await Promise.all([
    prisma.setting.findUnique({ where: { key: calendarRoleKey(channelId) } }),
    prisma.channel.findUnique({ where: { id: channelId } })
  ]);
  const selected = Number(setting?.value);
  if (selected && channel) {
    const actor = await prisma.actor.findUnique({
      where: { id: selected },
      include: { character: true }
    });
    if (
      actor?.status === "active" &&
      actor.character?.enabled &&
      virtualCharacterVisibleInChannel(channel, {
        username: actor.username,
        config: actor.character.config
      })
    )
      return { actor, fallback: false };
  }
  // Actor names share a namespace with accounts. Never impersonate an existing user.
  for (let suffix = 0; suffix < 100; suffix++) {
    const username = `system_calendar${suffix ? `_${suffix}` : ""}`;
    const actor = await prisma.actor.upsert({
      where: { username },
      update: {},
      create: {
        username,
        displayName: "日历",
        kind: "system",
        avatarPath: "/images/calendar-avatar.svg"
      }
    });
    if (actor.kind === "system" && !actor.accountId) return { actor, fallback: Boolean(selected) };
  }
  throw new Error("无法创建日历提醒角色，请管理员检查角色名称");
}
export function reminderBody(
  event: Pick<CalendarEvent, "reminderText" | "title" | "timeZone" | "allDay">,
  at: Date
) {
  const time = new Intl.DateTimeFormat("zh-CN", {
    timeZone: event.timeZone,
    dateStyle: "medium",
    ...(event.allDay ? {} : { timeStyle: "short" as const })
  }).format(at);
  return `${event.reminderText || `提醒：${event.title}`}\n📅 ${time}${event.allDay ? "（全天）" : ""} · ${event.timeZone}`;
}
export interface CalendarSchedulerDeps {
  prisma: PrismaClient;
  canAccessChannel(accountId: number, channelId: number): Promise<boolean>;
  canWriteChannel(accountId: number, channelId: number): Promise<boolean>;
  publishMessage(messageId: number): Promise<void>;
  warn(error: unknown): void;
}
export function createCalendarScheduler(deps: CalendarSchedulerDeps) {
  const { prisma } = deps;
  let running: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  async function run(now: Date) {
    const events = await prisma.calendarEvent.findMany({
      where: { paused: false, reminderMode: { not: "off" } }
    });
    for (const event of events) {
      if (!(await deps.canAccessChannel(event.ownerAccountId, event.channelId))) continue;
      const offsets = Array.isArray(event.reminders)
        ? event.reminders.filter((x): x is number => typeof x === "number")
        : [];
      for (const [index, offset] of offsets.entries()) {
        const from = new Date(now.getTime() - 86400000 + offset * 60000);
        const to = new Date(now.getTime() + offset * 60000 + 1);
        for (const at of occurrenceStarts(event, from, to)) {
          const dueAt = new Date(at.getTime() - offset * 60000);
          if (dueAt < event.updatedAt) continue;
          const group = event.reminderMode !== "private";
          if (group && !(await deps.canWriteChannel(event.ownerAccountId, event.channelId)))
            continue;
          const identity = group ? await calendarActor(prisma, event.channelId) : null;
          try {
            await prisma.$transaction(async (tx) => {
              // Serializes delivery against edits/deletion and other workers.
              const locked = await tx.$queryRaw<
                Array<{ revision: number; paused: number }>
              >`SELECT revision, paused FROM calendar_events WHERE id = ${event.id} FOR UPDATE`;
              if (!locked[0] || locked[0].revision !== event.revision || locked[0].paused) return;
              const key = {
                eventId: event.id,
                revision: event.revision,
                occurrenceAt: at,
                reminderIndex: index
              };
              if (
                await tx.calendarDelivery.findUnique({
                  where: { eventId_revision_occurrenceAt_reminderIndex: key }
                })
              )
                return;
              const missed = group && now.getTime() - dueAt.getTime() > 3600000;
              const delivery = await tx.calendarDelivery.create({
                data: { ...key, status: missed ? "missed" : "sent" }
              });
              if (missed) return;
              if (!group) {
                await tx.calendarNotice.create({
                  data: { deliveryId: delivery.id, accountId: event.ownerAccountId }
                });
                return;
              }
              const previous =
                event.reminderMode === "chain"
                  ? await tx.calendarDelivery.findFirst({
                      where: { eventId: event.id, occurrenceAt: at, messageId: { not: null } },
                      orderBy: { id: "asc" }
                    })
                  : null;
              const body = reminderBody(event, at);
              // Config has already passed the shared input validator on write.
              const raw = event.chainConfig as {
                requiredSelection: boolean;
                allowMultiple: boolean;
                options: string[];
              } | null;
              const chain = event.reminderMode === "chain" && !previous;
              const message = await tx.message.create({
                data: {
                  channelId: event.channelId,
                  senderActorId: identity!.actor.id,
                  calendarOwnerActorId: event.ownerActorId,
                  type: chain ? "chain" : "text",
                  content: body,
                  ...(chain
                    ? {
                        payload: createChainPayload(
                          body,
                          raw?.requiredSelection ? { ...raw, requiredSelection: true } : undefined
                        ) as unknown as Prisma.InputJsonObject
                      }
                    : {}),
                  ...(previous?.messageId ? { replyToId: previous.messageId } : {})
                }
              });
              if (chain)
                await tx.message.update({
                  where: { id: message.id },
                  data: { chainRootId: message.id, chainVersion: 1 }
                });
              await tx.calendarDelivery.update({
                where: { id: delivery.id },
                data: { messageId: message.id }
              });
            });
          } catch (error) {
            if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"))
              deps.warn(error);
          }
        }
      }
    }
    // Durable outbox: failed broadcasts retry the same stored message, never create another.
    const pending = await prisma.calendarDelivery.findMany({
      where: { messageId: { not: null }, broadcastedAt: null },
      take: 100
    });
    for (const row of pending) {
      try {
        await deps.publishMessage(row.messageId!);
        await prisma.calendarDelivery.update({
          where: { id: row.id },
          data: { broadcastedAt: now }
        });
      } catch (error) {
        deps.warn(error);
      }
    }
  }
  function tick(now = new Date()) {
    if (running) return running;
    running = run(now).finally(() => {
      running = null;
    });
    return running;
  }
  return {
    tick,
    start() {
      if (!timer) {
        timer = setInterval(() => {
          void tick().catch(deps.warn);
        }, 15000);
        timer.unref();
        void tick().catch(deps.warn);
      }
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      await running?.catch(deps.warn);
    }
  };
}
