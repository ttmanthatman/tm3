import { expect, test, type Page } from "@playwright/test";

const meetingUrl = "https://zoom.us/j/123456789?pwd=gather-fixture";
test.use({ hasTouch: true });

async function mountGather(page: Page, options: { admin?: boolean; active?: boolean; calendar?: boolean } = {}) {
  await page.route("**/api/zoom", route => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ url: meetingUrl, meeting: null, live: { status: options.active ? "active" : "inactive" } })
  }));
  // No test opens a real meeting.
  await page.context().route("https://zoom.us/**", route => route.fulfill({ contentType: "text/html", body: "Meeting fixture" }));
  await page.route("**/gather-control-harness", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><meta charset="utf-8"><div id="host"></div>' }));
  await page.goto("/gather-control-harness");
  const loaded = page.waitForResponse(response => response.url().endsWith("/api/zoom"));
  await page.evaluate(async options => {
    const path = "/src/client/features/chat/GatherControl.vue";
    const source = await (await fetch(path)).text();
    const vuePath = /from ["']([^"']*\/vue\.js[^"']*)["']/.exec(source)?.[1];
    if (!vuePath) throw new Error("missing Vue runtime");
    const { createApp, h, ref } = await import(vuePath) as typeof import("vue");
    const { default: Control } = await import(path);
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "/src/client/styles.css";
    document.head.append(css);
    await new Promise<void>((resolve, reject) => { css.onload = () => resolve(); css.onerror = () => reject(new Error("styles failed")); });
    const calendarOpened = ref(false);
    createApp({ render: () => h("main", { style: "width:100%;padding:16px;box-sizing:border-box" }, [
      h("header", { style: "display:flex;justify-content:flex-end" }, [h(Control, {
        isAdmin: options.admin ?? false,
        calendarAvailable: options.calendar ?? true,
        onOpenCalendar: () => { calendarOpened.value = true; }
      })]),
      h("button", { type: "button", style: "margin-top:120px" }, "菜单外部"),
      h("output", { "aria-label": "日历选择结果" }, calendarOpened.value ? "已打开日历" : "")
    ]) }).mount(document.getElementById("host")!);
  }, options);
  await loaded;
  await expect(page.getByRole("button", { name: "聚", exact: true })).toBeVisible();
}

for (const width of [360, 390, 1280]) {
  test(`gather menu supports calendar selection, keyboard and outside closing at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await mountGather(page);
    const trigger = page.getByRole("button", { name: "聚", exact: true });
    await trigger.click();
    const menu = page.getByRole("menu", { name: "聚", exact: true });
    await expect(menu.getByRole("menuitem")).toHaveText(["我们的日历", "线上会议"]);
    await expect(menu.getByRole("menuitem", { name: "我们的日历" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: "线上会议", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    const bounds = await menu.boundingBox();
    expect(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width).toBeTruthy();
    await menu.screenshot({ path: test.info().outputPath(`gather-menu-${width}.png`) });
    await page.getByRole("button", { name: "菜单外部" }).click();
    await expect(menu).toHaveCount(0);
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("日历选择结果")).toHaveText("已打开日历");
    await expect(menu).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("an unavailable group calendar stays disabled and members cannot open meeting settings", async ({ page }) => {
  await mountGather(page, { calendar: false });
  const trigger = page.getByRole("button", { name: "聚", exact: true });
  await trigger.focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await trigger.click();
  await expect(page.getByRole("menuitem", { name: "我们的日历" })).toBeDisabled();
  await expect(page.getByRole("menuitem", { name: "线上会议", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "前往 Zoom", exact: true });
  await expect(dialog).toContainText("目前还没有会议");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("an active meeting remains visible on gather and opens directly", async ({ page }) => {
  await mountGather(page, { active: true });
  const trigger = page.getByRole("button", { name: "聚", exact: true });
  await expect(trigger).toHaveAttribute("title", /正在开会/);
  await trigger.click();
  const meeting = page.getByRole("menuitem", { name: /线上会议/ });
  await expect(meeting).toContainText("进行中");
  const popupPromise = page.waitForEvent("popup");
  await meeting.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(meetingUrl);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await popup.close();
});

test("administrator long press opens settings without joining, and the next menu meeting action works", async ({ page }) => {
  await mountGather(page, { admin: true });
  const trigger = page.getByRole("button", { name: "聚", exact: true });
  const bounds = await trigger.boundingBox();
  if (!bounds) throw new Error("missing gather trigger");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await expect(page.getByRole("dialog", { name: "Zoom 会议状态", exact: true })).toBeVisible();
  expect(page.context().pages()).toHaveLength(1);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole("menuitem", { name: "线上会议", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "前往 Zoom", exact: true })).toBeVisible();
});
