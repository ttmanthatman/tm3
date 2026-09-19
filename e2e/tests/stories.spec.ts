import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import fs from "node:fs/promises";
import { E2E_ADMIN } from "../seed-data.js";

test.use({ permissions: ["microphone"], launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });

test("故事发布、录音、称呼、权限、重试与响应式浏览", async ({ page, request }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.getByPlaceholder("用户名").fill(E2E_ADMIN.username);
  await page.getByPlaceholder("密码").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByTestId("active-channel-name")).toBeVisible();
  const token = await page.evaluate(() => localStorage.getItem("team-chat-token"));
  const headers = { Authorization: `Bearer ${token}` };
  const me = (await (await request.get("/api/auth/me", { headers })).json()).account;
  await page.locator(".story-header-trigger").click();
  await expect(page.getByRole("dialog", { name: "我们的故事" })).toBeVisible();
  await page.getByRole("button", { name: "我们的故事，点击切换" }).click();
  await expect(page.getByRole("dialog", { name: "我的故事" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "故事，从这一刻开始" })).toBeVisible();
  await expect(page.getByRole("button", { name: "编辑故事签名" })).toHaveText("小小的故事，大大的恩典");
  await page.getByRole("button", { name: "编辑故事签名" }).click();
  await page.getByLabel("故事签名", { exact: true }).fill("平凡日子里的恩典，慢慢记下。");
  await page.getByRole("button", { name: "保存签名", exact: true }).click();
  await expect(page.getByRole("button", { name: "编辑故事签名" })).toHaveText("平凡日子里的恩典，慢慢记下。");
  await expect(page.locator(".story-banner")).toHaveText("");
  expect(await page.locator(".story-workspace > .modal-head").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  await page.getByRole("button", { name: "留下第一段故事" }).click();
  await page.getByLabel("这一刻，想说些什么", { exact: false }).fill("九月的风里，留住这一刻\n风很温柔，湖水也很安静。");
  await expect(page.getByRole("button", { name: "发布故事", exact: true })).toBeDisabled();
  await page.getByLabel("添加故事照片").setInputFiles("e2e/fixtures/story-sample.heic");
  await expect.poll(() => page.locator(".story-draft-image img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBeTruthy();
  await page.getByRole("button", { name: "移除照片 1", exact: true }).click();
  let photoPath = "output/e2e/story-lake.png";
  try { await fs.access(photoPath); } catch { photoPath = "public/images/stories/story-banner.png"; }
  await page.getByLabel("添加故事照片").setInputFiles([photoPath, photoPath, photoPath]);
  await page.getByRole("button", { name: "照片 3 前移" }).click();
  await page.getByRole("button", { name: "录一段声音" }).click();
  await expect(page.getByRole("button", { name: /结束录音 · [1-9]\d* 秒/ })).toBeVisible();
  await page.getByRole("button", { name: /结束录音/ }).click();
  await expect(page.getByRole("button", { name: "移除语音" })).toBeVisible();
  await page.getByRole("button", { name: "播放故事语音", exact: true }).click();
  await expect(page.getByRole("button", { name: "暂停故事语音" })).toBeVisible();
  await page.getByRole("button", { name: "暂停故事语音" }).click();

  // A transport failure must leave the draft intact and allow a safe retry.
  let failNext = true;
  await page.route("**/api/stories", async (route) => {
    if (route.request().method() === "POST" && failNext) { failNext = false; await route.abort("failed"); }
    else await route.continue();
  });
  await page.getByRole("button", { name: "发布故事", exact: true }).click();
  await expect(page.locator(".story-composer [role=alert]")).toBeVisible();
  await expect(page.getByLabel("这一刻，想说些什么", { exact: false })).toHaveValue(/九月的风里/);
  await page.getByRole("button", { name: "发布故事", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "留下一段故事" })).toBeHidden();
  await expect(page.locator(".story-moment")).toHaveCount(1);
  await expect(page.getByText("我们的故事，都在祂的故事里。", { exact: true })).toBeVisible();
  expect(await page.locator(".story-caption").evaluate((el) => getComputedStyle(el).fontSize)).toBe(await page.locator(".story-workspace").evaluate((el) => getComputedStyle(el).getPropertyValue("--message-content-font-size").trim()));
  expect(await page.locator(".story-first-like").evaluate((el) => getComputedStyle(el).fontSize)).toBe(await page.locator(".story-workspace").evaluate((el) => getComputedStyle(el).getPropertyValue("--message-content-font-size").trim()));
  await expect(page.getByRole("button", { name: "播放故事语音", exact: true })).toBeVisible();
  const own = (await (await request.get(`/api/stories?actorId=${me.actorId}`, { headers })).json()).stories[0];
  expect(own.media).toHaveLength(4);
  await page.getByRole("button", { name: "查看照片 1，共 3 张" }).click();
  await expect(page.getByRole("dialog", { name: "照片 1 / 3" })).toBeVisible();
  await page.getByRole("button", { name: "下一张照片" }).click();
  await expect(page.getByRole("dialog", { name: "照片 2 / 3" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "照片 2 / 3" })).toBeHidden();

  for (const width of [360, 390, 552, 959, 1303, 1280]) {
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 });
    await expect(page.getByRole("button", { name: "关闭故事" })).toBeVisible();
    expect(await page.locator(".story-workspace").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBeTruthy();
    await page.screenshot({ path: `output/e2e/stories-${width}.png` });
  }
  await page.getByRole("button", { name: "展开故事" }).click();
  await expect(page.getByRole("dialog", { name: "故事详情" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "关闭故事" }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("性别", { exact: true }).selectOption("female");
  await page.getByRole("button", { name: "保存资料", exact: true }).click();
  await expect(page.getByText("个人资料已保存", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭设置" }).click();
  expect((await (await request.get("/api/auth/me", { headers })).json()).account.gender).toBe("female");

  // Open the real avatar menu; a gender change must be reflected on each open.
  const username = `story-reader-${Date.now()}`;
  const password = "StoryTest123!";
  const created = await request.post("/api/admin/accounts", { headers, data: { username, displayName: "故事读者", password } });
  expect(created.ok()).toBeTruthy();
  const login = await (await request.post("/api/auth/login", { data: { username, password } })).json();
  const readerHeaders = { Authorization: `Bearer ${login.token}` };
  for (const [gender, label] of [["unspecified", "TA的故事"], ["female", "她的故事"], ["male", "他的故事"]]) {
    expect((await request.patch("/api/me/profile", { headers: readerHeaders, data: { displayName: "故事读者", gender } })).ok()).toBeTruthy();
    await page.getByRole("button", { name: "更多管理功能", exact: true }).click();
    await page.getByRole("menuitem", { name: "成员列表", exact: true }).click();
    await page.locator(".member-row").filter({ hasText: "故事读者" }).click();
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByRole("dialog", { name: label, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "故事正在酝酿" })).toBeVisible();
    await page.getByRole("button", { name: "关闭故事" }).click();
    await page.getByRole("button", { name: "收起成员", exact: true }).click();
  }

  // Create a second regular account to verify titles and attachment permissions
  // against the actual MySQL membership query, then restore channel settings.
  const author = await request.get(`/api/stories/authors/${me.actorId}`, { headers: readerHeaders });
  expect((await author.json()).author.gender).toBe("female");
  const mediaUrl = `/api/stories/media/${own.media[0].id}`;
  expect((await request.get(mediaUrl, { headers: readerHeaders })).status()).toBe(200);
  expect((await request.delete(`/api/stories/${own.id}`, { headers: readerHeaders })).status()).toBe(404);
  const readerLike = await request.put(`/api/stories/${own.id}/like`, { headers: readerHeaders, data: { liked: true } });
  expect(readerLike.ok()).toBeTruthy();
  expect((await readerLike.json()).interactions.likeCount).toBe(1);
  const readerComment = await request.post(`/api/stories/${own.id}/comments`, { headers: readerHeaders, data: { text: "愿平凡的日子常有喜乐。" } });
  expect(readerComment.status()).toBe(201);
  const prisma = new PrismaClient();
  const channels = await prisma.channel.findMany({ select: { id: true, isPrivate: true } });
  try {
    await prisma.channel.updateMany({ data: { isPrivate: true } });
    expect((await request.get(mediaUrl, { headers: readerHeaders })).status()).toBe(404);
    expect((await request.get(`/api/stories?actorId=${me.actorId}`, { headers: readerHeaders })).status()).toBe(404);
    await prisma.channelMember.createMany({ data: [me.id, login.account.id].map((accountId) => ({ channelId: channels[0].id, accountId })), skipDuplicates: true });
    expect((await request.get(mediaUrl, { headers: readerHeaders })).status()).toBe(200);
    await prisma.channelMember.deleteMany({ where: { channelId: channels[0].id, accountId: login.account.id } });
    expect((await request.get(mediaUrl, { headers: readerHeaders })).status()).toBe(404);
  } finally {
    for (const channel of channels) await prisma.channel.update({ where: { id: channel.id }, data: { isPrivate: channel.isPrivate } });
    await prisma.$disconnect();
  }

  // A saved story survives reload and owner deletion invalidates its media.
  await page.reload();
  await expect(page.getByTestId("active-channel-name")).toBeVisible();
  await page.locator(".story-header-trigger").click();
  await page.getByRole("button", { name: "我们的故事，点击切换" }).click();
  await expect(page.getByRole("button", { name: "编辑故事签名" })).toHaveText("平凡日子里的恩典，慢慢记下。");
  await expect(page.locator(".story-moment")).toHaveCount(1);
  await expect(page.getByText("愿平凡的日子常有喜乐。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "点赞", exact: true }).click();
  await expect(page.getByRole("button", { name: "取消点赞", exact: true })).toBeVisible();
  await page.getByLabel("评论内容", { exact: true }).fill("谢谢你的祝福！");
  await page.getByRole("button", { name: "发表评论", exact: true }).click();
  await expect(page.getByText("谢谢你的祝福！", { exact: true })).toBeVisible();
  await expect(page.locator(".story-interactions")).toHaveAttribute("aria-label", "故事互动，共 2 个赞、2 条评论");
  const socialGeometry = await page.locator(".story-interactions").evaluate((panel) => {
    const workspace = panel.closest(".story-workspace") as HTMLElement;
    const comments = [...panel.querySelectorAll<HTMLElement>(".story-comment-list li")];
    const firstSeparator = getComputedStyle(comments[0], "::after");
    const lastSeparator = getComputedStyle(comments.at(-1)!, "::after");
    const submit = panel.querySelector<HTMLElement>(".story-comment-form button")!;
    const plane = submit.querySelector<SVGElement>("svg")!;
    const submitBox = submit.getBoundingClientRect();
    const planeBox = plane.getBoundingClientRect();
    return {
      messageFontSize: getComputedStyle(workspace).getPropertyValue("--message-content-font-size").trim(),
      commentFontSizes: comments.map((comment) => ({
        author: getComputedStyle(comment.querySelector("strong")!).fontSize,
        body: getComputedStyle(comment.querySelector("p")!).fontSize,
      })),
      commentRowTopBorder: getComputedStyle(panel.querySelector(".story-comment-row")!).borderTopWidth,
      iconRightBorders: [...panel.querySelectorAll(".story-social-icon")].map((icon) => getComputedStyle(icon).borderRightWidth),
      firstSeparator: { content: firstSeparator.content, left: Number.parseFloat(firstSeparator.left), right: Number.parseFloat(firstSeparator.right) },
      lastSeparatorContent: lastSeparator.content,
      planeCenterOffset: {
        x: planeBox.left + planeBox.width / 2 - (submitBox.left + submitBox.width / 2),
        y: planeBox.top + planeBox.height / 2 - (submitBox.top + submitBox.height / 2),
      },
    };
  });
  expect(socialGeometry.commentFontSizes).toEqual([
    { author: socialGeometry.messageFontSize, body: socialGeometry.messageFontSize },
    { author: socialGeometry.messageFontSize, body: socialGeometry.messageFontSize },
  ]);
  expect(socialGeometry.commentRowTopBorder).toBe("0px");
  expect(socialGeometry.iconRightBorders).toEqual(["0px", "0px"]);
  expect(socialGeometry.firstSeparator.content).not.toBe("none");
  expect(socialGeometry.firstSeparator.left).toBeGreaterThan(0);
  expect(socialGeometry.firstSeparator.right).toBe(0);
  expect(socialGeometry.lastSeparatorContent).toBe("none");
  expect(socialGeometry.planeCenterOffset.x).toBeCloseTo(1, 0);
  expect(socialGeometry.planeCenterOffset.y).toBeCloseTo(-1, 0);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.screenshot({ path: `output/e2e/stories-social-${width}.png` });
  }
  await page.getByRole("button", { name: "删除 故事读者 的评论", exact: true }).click();
  await expect(page.getByText("愿平凡的日子常有喜乐。", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "删除故事", exact: true }).click();
  await page.getByRole("dialog", { name: "删除这段故事？" }).getByRole("button", { name: "删除故事", exact: true }).click();
  await expect(page.getByRole("heading", { name: "故事，从这一刻开始" })).toBeVisible();
  expect((await request.get(mediaUrl, { headers })).status()).toBe(404);
  await page.getByRole("button", { name: "留下第一段故事" }).click();
  await page.getByLabel("添加故事照片").setInputFiles("e2e/fixtures/story-sample.heic");
  await expect(page.getByRole("button", { name: "发布故事", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "发布故事", exact: true }).click();
  await expect(page.locator(".story-photos.single img")).toBeVisible();
  for (const width of [360, 390, 552, 959, 1303]) {
    await page.setViewportSize({ width, height: 1122 });
    const single = page.locator(".story-photos.single img");
    await expect.poll(() => single.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBeTruthy();
    const sizes = await single.evaluate((img: HTMLImageElement) => ({ box: img.getBoundingClientRect().width / img.getBoundingClientRect().height, natural: img.naturalWidth / img.naturalHeight, parent: img.parentElement!.getBoundingClientRect().width, width: img.getBoundingClientRect().width }));
    expect(Math.abs(sizes.box - sizes.natural)).toBeLessThan(0.02);
    expect(Math.abs(sizes.parent - sizes.width)).toBeLessThan(1);
    await page.screenshot({ path: `output/e2e/stories-single-${width}.png` });
  }
  await page.getByRole("button", { name: "展开故事", exact: true }).click();
  for (const width of [390, 552, 1303]) {
    await page.setViewportSize({ width, height: 1122 });
    const image = page.locator(".story-detail-photos img");
    await expect(image).toBeVisible();
    const sizes = await image.evaluate((img: HTMLImageElement) => ({ width: img.getBoundingClientRect().width, parent: img.parentElement!.getBoundingClientRect().width }));
    expect(Math.abs(sizes.parent - sizes.width)).toBeLessThan(1);
  }
  expect(errors).toEqual([]);
});
