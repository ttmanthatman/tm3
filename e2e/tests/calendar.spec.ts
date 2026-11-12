import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { E2E_ADMIN } from "../seed-data.js";
import { createCalendarScheduler } from "../../src/server/services/calendar.js";
import { calendarInputSchema } from "../../src/shared/calendar.js";

test.use({ serviceWorkers: "block" });
test("group calendar permissions, private reminders, chain ownership and global split overlays", async ({
  page,
  request
}) => {
  test.setTimeout(120000);
  const prisma = new PrismaClient();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const admin = await (await request.post("/api/auth/login", { data: E2E_ADMIN })).json();
  const ah = { Authorization: `Bearer ${admin.token}` };
  const username = `calendar-${Date.now()}`,
    password = "Calendar123!";
  expect(
    (
      await request.post("/api/admin/accounts", {
        headers: ah,
        data: { username, password, displayName: "日历成员" }
      })
    ).ok()
  ).toBeTruthy();
  const member = await (
    await request.post("/api/auth/login", { data: { username, password } })
  ).json();
  const mh = { Authorization: `Bearer ${member.token}` };
  const channel = await prisma.channel.findFirstOrThrow({ where: { isDefault: true } });
  const base = `/api/channels/${channel.id}/calendar`;
  const occurrence = new Date(Date.now() + 3600000);
  const value = calendarInputSchema.parse({
    title: "私人安排",
    description: "不可泄露的说明",
    timeZone: "Asia/Shanghai",
    startAt: occurrence.toISOString(),
    endAt: new Date(occurrence.getTime() + 3600000).toISOString()
  });
  const create = await request.post(base, { headers: mh, data: value });
  expect(create.ok()).toBeTruthy();
  const eventId = (await create.json()).id;
  const from = new Date(occurrence.getTime() - 86400000).toISOString(),
    to = new Date(occurrence.getTime() + 86400000).toISOString();
  const url = `${base}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  expect(
    (await (await request.get(url, { headers: ah })).json()).events.some(
      (e: { id: number }) => e.id === eventId
    )
  ).toBeFalsy();
  const all = await (await request.get(`${url}&manage=true`, { headers: ah })).json();
  expect(all.events.some((e: { id: number }) => e.id === eventId)).toBeTruthy();
  // An unrelated ordinary member cannot read private details or mutate the event.
  const otherName = `${username}-other`;
  await request.post("/api/admin/accounts", {
    headers: ah,
    data: { username: otherName, password, displayName: "其他成员" }
  });
  const other = await (
    await request.post("/api/auth/login", { data: { username: otherName, password } })
  ).json();
  const oh = { Authorization: `Bearer ${other.token}` };
  expect((await (await request.get(url, { headers: oh })).json()).events).toHaveLength(0);
  expect(
    (
      await request.put(`${base}/${eventId}`, { headers: oh, data: { value, revision: 1 } })
    ).status()
  ).toBe(403);
  expect(
    (await request.delete(`${base}/${eventId}`, { headers: oh, data: { revision: 1 } })).status()
  ).toBe(403);
  expect(
    (
      await request.put(`/api/channels/${channel.id}/calendar-role`, {
        headers: mh,
        data: { actorId: null }
      })
    ).status()
  ).toBe(403);
  const sharedValue = {
    ...value,
    visibility: "members",
    memberIds: [other.account.id],
    reminderMode: "off"
  };
  const shared = await request.post(base, { headers: mh, data: sharedValue });
  expect(shared.ok()).toBeTruthy();
  const sharedId = (await shared.json()).id;
  expect(
    (await (await request.get(url, { headers: oh })).json()).events.some(
      (e: { id: number }) => e.id === sharedId
    )
  ).toBeTruthy();
  const secondChannel = await prisma.channel.findFirstOrThrow({
    where: { id: { not: channel.id }, kind: "standard" }
  });
  expect(
    (
      await request.put(`/api/channels/${secondChannel.id}/calendar/${eventId}`, {
        headers: mh,
        data: { value, revision: 1 }
      })
    ).status()
  ).toBe(404);
  expect(
    (
      await request.post(base, {
        headers: mh,
        data: { ...value, reminderMode: "text", reminderText: "公开内容" }
      })
    ).status()
  ).toBe(400);
  const groupValue = {
    ...value,
    title: "每次活动报名",
    visibility: "group",
    reminderMode: "chain",
    reminderText: "请大家报名",
    repeat: "daily"
  };
  const group = await request.post(base, { headers: mh, data: groupValue });
  expect(group.ok()).toBeTruthy();
  const groupId = (await group.json()).id;
  const warnings: unknown[] = [];
  const scheduler = createCalendarScheduler({
    prisma,
    canAccessChannel: async () => true,
    canWriteChannel: async () => true,
    publishMessage: async () => undefined,
    warn: (e) => warnings.push(e)
  });
  await scheduler.tick(occurrence);
  await scheduler.tick(occurrence);
  expect(warnings).toEqual([]);
  const delivered = await prisma.calendarDelivery.findMany({ where: { eventId: groupId } });
  expect(delivered).toHaveLength(1);
  const root = await prisma.message.findUniqueOrThrow({ where: { id: delivered[0].messageId! } });
  expect(root.type).toBe("chain");
  expect(root.calendarOwnerActorId).toBe(member.account.actorId);
  expect(root.content).not.toContain(value.description);
  expect((await request.post(`/api/chains/${root.id}/end`, { headers: mh })).ok()).toBeTruthy();
  expect(
    (await (await request.get("/api/calendar/notices", { headers: oh })).json()).notices
  ).toHaveLength(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.getByPlaceholder("用户名").fill(username);
  await page.getByPlaceholder("密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  const reminder = page.getByRole("dialog", { name: "日程提醒", exact: true });
  await expect(reminder).toBeVisible();
  expect(
    await reminder.evaluate((el) => {
      const r = el.querySelector(".calendar-notice-panel")!.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + 30));
    })
  ).toBeTruthy();
  await reminder.getByRole("button", { name: "知道了" }).click();
  await expect(reminder).toHaveCount(0);
  await page.getByRole("button", { name: "聚", exact: true }).click();
  await page.getByRole("menuitem", { name: "我们的日历" }).click();
  const calendar = page.getByRole("dialog", { name: /· 日历/ });
  await expect(calendar).toBeVisible();
  await calendar.getByRole("button", { name: "新建日程" }).click();
  const detail = page.getByRole("dialog", { name: /^(新建日程|日程详情)$/ });
  await expect(detail.getByLabel("提醒方式")).toHaveValue("private");
  await detail.getByLabel("标题", { exact: true }).fill("界面创建日程");
  await detail.getByLabel("提醒单位").selectOption("days");
  await detail.getByLabel("提前提醒", { exact: true }).fill("0,1,3");
  await detail.getByRole("button", { name: "保存日程", exact: true }).click();
  await expect(detail).toHaveCount(0);
  await expect(calendar.getByText("界面创建日程", { exact: true })).toBeVisible();
  const createdEvent = await prisma.calendarEvent.findFirstOrThrow({ where: { title: "界面创建日程" } });
  expect(createdEvent.reminders).toEqual([4320, 1440, 0]);
  await calendar.getByRole("button").filter({ hasText: "界面创建日程" }).click();
  await expect(detail.getByLabel("提醒单位")).toHaveValue("days");
  await expect(detail.getByLabel("提前提醒", { exact: true })).toHaveValue("3,1,0");
  await detail.getByRole("button", { name: "关闭日程详情" }).click();
  const categories = calendar.getByRole("group", { name: "日历分类" });
  for (const name of ["我们的日程", "教会节日", "犹太历节期", "中国节假日"]) {
    await expect(categories.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
  }
  await categories.getByRole("button", { name: "我们的日程", exact: true }).click();
  await expect(calendar.getByText("界面创建日程", { exact: true })).toHaveCount(0);
  await categories.getByRole("button", { name: "我们的日程", exact: true }).click();
  await expect(calendar.getByText("界面创建日程", { exact: true })).toBeVisible();
  const sizes = await page.evaluate(() => [".gather-glyph", ".music-player-glyph"].map(selector => {
    const style = getComputedStyle(document.querySelector(selector)!);
    return [style.fontSize, style.fontWeight, style.lineHeight];
  }));
  expect(sizes[0]).toEqual(sizes[1]);
  for (const width of [360, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const panel = calendar.locator(".calendar-panel");
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
    await expect(calendar.getByRole("button", { name: "关闭日历" })).toBeVisible();
    await expect(calendar.locator(".calendar-lunar-day")).toHaveCount(42);
    await calendar.screenshot({ path: test.info().outputPath(`calendar-${width}.png`) });
  }
  // Known dates exercise the merged month markers and each built-in calendar.
  const now = new Date();
  const monthsToApril = (2026 - now.getFullYear()) * 12 + 3 - now.getMonth();
  for (let i = 0; i < Math.abs(monthsToApril); i++)
    await calendar.getByRole("button", { name: monthsToApril < 0 ? "上个月" : "下个月" }).click();
  await calendar.getByRole("button", { name: /^2026-04-05 / }).click();
  await expect(calendar.locator(".calendar-holiday").filter({ hasText: "复活节" })).toBeVisible();
  await expect(calendar.locator(".calendar-holiday").filter({ hasText: "清明" })).toBeVisible();
  await categories.getByRole("button", { name: "教会节日", exact: true }).click();
  await expect(calendar.locator(".calendar-holiday").filter({ hasText: "复活节" })).toHaveCount(0);
  await expect(calendar.locator(".calendar-holiday").filter({ hasText: "清明" })).toBeVisible();
  await categories.getByRole("button", { name: "教会节日", exact: true }).click();
  await calendar.getByRole("button", { name: /^2026-04-02 / }).click();
  await expect(calendar.getByText("农历二月十五", { exact: true })).toBeVisible();
  await expect(calendar.locator(".calendar-holiday").filter({ hasText: "逾越节" })).toBeVisible();
  await calendar.screenshot({ path: test.info().outputPath("calendar-holidays.png") });
  await calendar.getByRole("button", { name: "关闭日历" }).click();
  // Queue new reminders while the reader is split, reversed, and fullscreen.
  for (const mode of ["split", "right", "fullscreen"]) {
    if (!(await page.locator(".bible-workspace").isVisible()))
      await page.getByRole("button", { name: "打开圣经", exact: true }).click();
    if (mode === "right")
      await page.getByRole("button", { name: "左右交换圣经和聊天", exact: true }).click();
    if (mode === "fullscreen")
      await page.getByRole("button", { name: "圣经全屏", exact: true }).click();
    const original = await prisma.calendarDelivery.findFirstOrThrow({ where: { eventId } });
    await prisma.calendarNotice.updateMany({
      where: { deliveryId: original.id },
      data: { readAt: null }
    });
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(reminder).toBeVisible();
    expect(
      await reminder.evaluate((el) => {
        const r = el.querySelector(".calendar-notice-panel")!.getBoundingClientRect();
        return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + 30));
      })
    ).toBeTruthy();
    await reminder.screenshot({ path: test.info().outputPath(`reminder-${mode}.png`) });
    await reminder.getByRole("button", { name: "知道了" }).click();
    await expect(reminder).toHaveCount(0);
  }
  expect(errors).toEqual([]);
  const currentMemberHeaders = {
    Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem("team-chat-token"))}`
  };
  expect(
    (
      await request.put(`${base}/${eventId}`, {
        headers: ah,
        data: { value: { ...value, title: "管理员调整", paused: true }, revision: 1 }
      })
    ).ok()
  ).toBeTruthy();
  expect(
    (
      await request.put(`${base}/${eventId}`, {
        headers: currentMemberHeaders,
        data: { value, revision: 1 }
      })
    ).status()
  ).toBe(409);
  await scheduler.tick(occurrence);
  expect(
    (await (await request.get("/api/calendar/notices", { headers: currentMemberHeaders })).json())
      .notices
  ).toHaveLength(0);
  expect(
    (await request.delete(`${base}/${eventId}`, { headers: ah, data: { revision: 2 } })).ok()
  ).toBeTruthy();
  await scheduler.stop();
  await prisma.$disconnect();
});
