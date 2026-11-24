import { expect, test, type APIRequestContext } from "@playwright/test";
import { closeBibleWorkspace, focusChat } from "../helpers/chat.js";
import { E2E_ADMIN, E2E_CHANNELS, E2E_MEMBER } from "../seed-data.js";
import type { ChannelDTO, MessageDTO } from "../../src/shared/types.js";
import type { BibleStudyProgress, BibleStudyRecordPage } from "../../src/shared/bibleStudy.js";

test.use({ serviceWorkers: "block" });
test.setTimeout(150_000);

async function authFor(request: APIRequestContext, user: typeof E2E_ADMIN | typeof E2E_MEMBER) {
  const response = await request.post("/api/auth/login", { data: user });
  expect(response.ok()).toBeTruthy();
  return { Authorization: `Bearer ${(await response.json()).token}` };
}

test("study rooms isolate answers, resume the same passage and archive a summary before a fresh model context", async ({ page, request }, testInfo) => {
  const database = new URL(process.env.DATABASE_URL || "invalid:");
  if (process.env.E2E_TEST_RUN !== "1" || process.env.NODE_ENV !== "test" || database.protocol !== "mysql:"
    || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(database.hostname) || database.pathname !== "/tm3_e2e")
    throw new Error("Study fixtures require the isolated local tm3_e2e runner.");

  const { buildApp } = await import("../../src/server/index.js");
  const app = await buildApp({ runStartupTasks: false });
  const originalFetch = globalThis.fetch;
  const calls: Array<Array<{ role: string; content: string }>> = [];
  let failures = 0;
  let plainOnce = false;
  const plainFollowUp = "你指出了门徒的反应。哪一节经文最能支持这个观察？";
  const summary = {
    action: "complete", mainPoint: "耶稣有平静风浪的权柄。", observations: "可 4:38 门徒问耶稣是否顾念他们。",
    gospel: "基督在十字架为我们舍命，显明他顾念我们。",
    response: "报告不如预期时，我可以先诚实说明困难，再向同事求助。",
    takeaway: "基督已为我舍命，我在压力下可以诚实求助。"
  };
  globalThis.fetch = async (input, init) => {
    if (!String(input).startsWith("https://api.deepseek.com/")) return originalFetch(input, init);
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }>; response_format?: { type: string } };
    calls.push(body.messages);
    if (!body.response_format) {
      expect(body.messages[0]?.content).toContain("停留在服务器给出的当前阶段");
      return Response.json({ choices: [{ message: { content: plainFollowUp } }] });
    }
    expect(body.response_format.type).toBe("json_object");
    if (failures > 0) {
      failures--;
      return new Response(null, { status: 503 });
    }
    if (plainOnce) {
      plainOnce = false;
      return Response.json({ choices: [{ message: { content: plainFollowUp } }] });
    }
    const instruction = body.messages[0]?.content ?? "";
    const stage = instruction.match(/当前阶段：(\w+)/)?.[1];
    const answer = body.messages.at(-1)?.content;
    const content = instruction.includes("用户要在这道题下另开追问分支")
      ? { action: "ask", text: `围绕这个问题再观察：${answer}？`, evidence: ["马可福音 4:38"], purpose: "从选择的父问题另开分支。" }
      : instruction.includes("用户暂时答不上来")
      ? { action: "ask", text: "第 38 节中门徒问了什么？", purpose: "先找到门徒说出的那句话。", evidence: ["马可福音 4:38"] }
      : answer === "我还注意到另一处细节。"
        ? { action: "ask", text: "风浪平静后，门徒怎样回应？", relation: "new_angle", purpose: "补看同一段经文的结尾。", evidence: ["马可福音 4:41"] }
        : stage === "response" ? summary : { action: "advance", text: `继续思考 ${stage}？`, feedback: "抓住了经文里的对比" };
    return Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] });
  };
  const admin = await authFor(request, E2E_ADMIN);
  try {
    const memberAccount = await request.post("/api/admin/accounts", { headers: admin, data: E2E_MEMBER });
    expect(memberAccount.ok(), await memberAccount.text()).toBeTruthy();
    const channels = await request.get("/api/channels", { headers: admin });
    const publicRoom = ((await channels.json()).channels as ChannelDTO[]).find(row => row.name === E2E_CHANNELS.default)!;
    expect(publicRoom).toBeTruthy();
    await page.route("**/*", route => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await page.goto("/");
    await page.getByPlaceholder("用户名").fill(E2E_MEMBER.username);
    await page.getByPlaceholder("密码").fill(E2E_MEMBER.password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
    const member = { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem("team-chat-token"))}` };
    const syncStatus = page.getByText("消息已同步 · 实时已连接", { exact: true });
    await expect(syncStatus).toHaveCount(0, { timeout: 4000 });
    await page.getByRole("button", { name: "打开图书室" }).click();
    await expect(page.getByRole("menuitem", { name: "书架" })).toBeVisible();
    await page.getByRole("menuitem", { name: "查经" }).click();
    await expect(page.getByTestId("active-channel-name")).toHaveText("同行书房");
    await expect(page.getByText(/站点管理员可在后台查看/)).toBeVisible();

    const privateRoom = ((await (await request.get("/api/channels", { headers: member })).json()).channels as ChannelDTO[])
      .find(row => row.name === "同行书房")!;
    expect(privateRoom).toMatchObject({ isPrivate: true, canManage: false });
    const roomLog = `/api/admin/bible-study/rooms/${privateRoom.id}`;
    const otherRoom = await request.post("/api/messages", { headers: admin, data: { channelId: publicRoom.id, content: "@查经助手" } });
    expect(otherRoom.ok(), await otherRoom.text()).toBeTruthy();
    const otherRoomId = (await otherRoom.json()).enteredChannelId;
    expect(otherRoomId).toBeGreaterThan(0);
    expect(otherRoomId).not.toBe(privateRoom.id);
    expect((await request.get(`/api/messages?channelId=${privateRoom.id}`, { headers: admin })).status()).toBe(403);
    expect((await request.get(roomLog, { headers: member })).status()).toBe(403);
    expect((await request.get("/api/admin/bible-study/rooms", { headers: member })).status()).toBe(403);

    expect((await app.inject({ method: "POST", url: "/api/admin/ai-settings", headers: admin, payload: { apiKey: "offline-test-key" } })).statusCode).toBe(200);
    async function send(content: string) {
      const response = await app.inject({ method: "POST", url: "/api/messages", headers: member, payload: { channelId: privateRoom.id, content } });
      expect(response.statusCode).toBe(200);
      return response.json().message as MessageDTO | undefined;
    }
    async function records() {
      const response = await app.inject({ method: "GET", url: roomLog, headers: admin });
      expect(response.statusCode).toBe(200);
      return response.json<BibleStudyRecordPage>().records;
    }
    async function waitFor(text: string) {
      await expect.poll(async () => (await records()).some(row => row.content.includes(text))).toBe(true);
    }

    await send("马可福音 4:35-41");
    await waitFor("哪一句话或哪一个细节");
    await page.reload();
    await closeBibleWorkspace(page);
    const focus = page.getByRole("region", { name: "查经进度" });
    await expect(focus).toContainText("观察经文");
    await expect(focus).toContainText("已问 1 题");
    for (const width of [360, 390, 1280]) {
      await page.setViewportSize({ width, height: 850 });
      const bounds = await focus.boundingBox();
      expect(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width).toBe(true);
    }
    const verseText = page.locator(".reading-text");
    await expect(verseText.locator("sup")).toHaveCount(2);
    await page.getByRole("button", { name: "展开全段", exact: true }).click();
    await expect(verseText.locator("sup")).toHaveCount(7);
    await page.getByRole("button", { name: "收起经文", exact: true }).click();
    await expect(verseText.locator("sup")).toHaveCount(2);
    expect(await verseText.locator("p").count()).toBeLessThan(7);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const reading = page.locator(".study-reading");
    await reading.getByRole("button", { name: "复制经文" }).click({ timeout: 8000 });
    await expect(reading.getByRole("button", { name: "已复制" })).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain("那天晚上");
    expect(copied).not.toMatch(/\d|马可福音/);
    expect(copied).not.toContain("哪一句话");
    await page.getByRole("button", { name: /收起进度/ }).click();
    await expect(focus).toBeHidden();
    await expect(page.getByRole("button", { name: "展开查经进度" })).toBeVisible();
    await expect(focus).toBeVisible({ timeout: 6400 });
    await send("换成诗篇 23");
    await waitFor("需要完成后才可以换题");
    await page.reload();
    await closeBibleWorkspace(page);
    await expect(page.getByText("完成这段经文后就可以换题。", { exact: false })).toBeVisible();
    await send("/结束");
    await expect.poll(async () => (await records()).filter(row => row.content.includes("需要完成后才可以换题")).length).toBe(2);
    expect(calls).toHaveLength(0);
    expect((await request.get(`/api/messages?channelId=${publicRoom.id}`, { headers: admin })).ok()).toBe(true);
    const { messages } = await (await request.get(`/api/messages?channelId=${publicRoom.id}`, { headers: admin })).json() as { messages: MessageDTO[] };
    expect(messages.some(message => message.content.includes("@查经助手") || message.sender.displayName === "查经助手")).toBe(false);

    failures = 2;
    const answer = await send("门徒在第 38 节问耶稣是否顾念他们。独立上下文标记。");
    await waitFor("你的答复已经保存");
    expect((await records()).some(row => row.id === answer?.id)).toBe(true);
    expect((await request.post(`/api/messages/${answer?.id}/recall`, { headers: member })).status()).toBe(409);
    expect((await request.delete(`/api/admin/messages/${answer?.id}`, { headers: admin })).status()).toBe(404);
    await page.route("**/api/bible-study/retry", async route => {
      const result = await app.inject({ method: "POST", url: "/api/bible-study/retry", headers: member });
      await route.fulfill({ status: result.statusCode, json: result.json() });
    });
    await page.route("**/api/bible-study/progress", async route => {
      const result = await app.inject({ method: "GET", url: "/api/bible-study/progress", headers: member });
      await route.fulfill({ status: result.statusCode, json: result.json() });
    });
    // Recreate the participant panel against the in-process server that owns the
    // offline model. A real room join would also resume the pending turn.
    await page.route(/\/socket\.io\/.*transport=polling/, route => route.abort());
    await page.routeWebSocket("**/socket.io/**", socket => socket.close());
    await page.reload();
    await closeBibleWorkspace(page);
    await expect(page.getByText("AI 服务暂时繁忙或不可用，你的答复已保存。")).toBeVisible();
    plainOnce = true;
    await page.getByRole("button", { name: "重试回应" }).click();
    await waitFor(plainFollowUp);
    const fallbackProgress = await app.inject({ method: "GET", url: "/api/bible-study/progress", headers: member });
    expect(fallbackProgress.json().progress).toMatchObject({ stage: "observe", questions: 2, failure: null });
    await send("第38节门徒质问耶稣，第41节他们仍然惧怕。");
    await waitFor("继续思考 observe");
    const progress = await app.inject({ method: "GET", url: "/api/bible-study/progress", headers: member });
    expect(progress.json().progress).toMatchObject({ stage: "interpret", questions: 3, feedbackDetail: "抓住了经文里的对比", failure: null });
    const readProgress = async () =>
      (await app.inject({ method: "GET", url: "/api/bible-study/progress", headers: member })).json<{ progress: BibleStudyProgress }>().progress;
    const originalQuestion = (await readProgress()).questionPath.at(-1)!;
    expect(originalQuestion).toMatchObject({ stage: "interpret", relation: "advance" });
    const foreignRequest = await app.inject({
      method: "POST", url: "/api/bible-study/help", headers: admin, payload: { questionId: originalQuestion.id }
    });
    expect(foreignRequest.statusCode).toBe(409);
    await page.route("**/api/bible-study/help", async route => {
      const result = await app.inject({ method: "POST", url: "/api/bible-study/help", headers: member, payload: route.request().postDataJSON() });
      await route.fulfill({ status: result.statusCode, json: result.json() });
    });
    await page.reload();
    await closeBibleWorkspace(page);
    await page.getByRole("button", { name: "答不上来", exact: true }).click();
    await expect.poll(async () => (await readProgress()).questionPath.at(-1)?.relation).toBe("hint");
    const hint = (await readProgress()).questionPath.at(-1)!;
    expect(hint).toMatchObject({ parentId: originalQuestion.id, returnToId: originalQuestion.id, evidence: ["马可福音 4:38"] });
    await page.reload();
    await closeBibleWorkspace(page);
    await expect(page.getByRole("article", { name: "当前问题" })).toContainText("答完这一步，我们回到原题。");
    await expect(page.getByRole("region", { name: "问题脉络" })).toContainText("把原题拆小");
    await send("门徒问耶稣是否顾念他们。");
    await expect.poll(async () => (await readProgress()).questionPath.at(-1)?.relation).toBe("return");
    expect((await readProgress()).questionPath.at(-1)).toMatchObject({ text: originalQuestion.text, parentId: hint.id, returnToId: originalQuestion.id });
    await send("我还注意到另一处细节。");
    await expect.poll(async () => (await readProgress()).questionPath.at(-1)?.relation).toBe("new_angle");
    await page.reload();
    await closeBibleWorkspace(page);
    const path = page.getByRole("region", { name: "问题脉络" });
    await expect(path).toContainText("换个观察角度");
    await expect(page.getByRole("article", { name: "当前问题" })).toContainText("补看同一段经文的结尾");
    for (const width of [360, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(path).toBeVisible();
      expect(await page.locator(".study-workspace").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      if (width < 760) {
        await expect.poll(() => page.locator(".channel-pane").evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
      }
      if (width === 390 || width === 1280) await page.screenshot({ path: testInfo.outputPath(`study-workspace-${width}.png`) });
    }
    await page.getByRole("button", { name: "查经记录", exact: true }).click({ timeout: 10_000 });
    const history = page.getByRole("dialog", { name: "查经记录" });
    await expect(history).toContainText("把原题拆小");
    await expect(history).toContainText("回到原题");
    await page.keyboard.press("Escape");
    await expect(history).toHaveCount(0);

    await page.route("**/api/bible-study/answer", async route => {
      const result = await app.inject({ method: "POST", url: "/api/bible-study/answer", headers: member, payload: route.request().postDataJSON() });
      await route.fulfill({ status: result.statusCode, json: result.json() });
    });
    const beforeBranch = (await readProgress()).questionPath.length;
    const rootLabel = `Q${(await readProgress()).questionPath.findIndex(q => q.id === originalQuestion.id) + 1}`;
    async function branch(label: string, text: string) {
      await page.getByRole("button", { name: `继续追问 ${label}`, exact: true }).click();
      await page.getByPlaceholder("还想从这个问题追问什么？").fill(text, { timeout: 10_000 });
      await page.getByRole("button", { name: "发起追问", exact: true }).click();
      await expect.poll(async () => (await readProgress()).questionPath.at(-1)?.text).toContain(text);
      await page.reload();
      await closeBibleWorkspace(page);
      return (await readProgress()).questionPath.at(-1)!;
    }
    const firstBranch = await branch(rootLabel, "另看门徒的反应");
    expect(firstBranch.parentId).toBe(originalQuestion.id);
    expect((await readProgress()).stage).toBe(originalQuestion.stage);
    await branch(`q${beforeBranch + 1}`, "再追一层");
    const siblingBranch = await branch(rootLabel, "从原题另开一个角度");
    expect(siblingBranch.parentId).toBe(originalQuestion.id);
    const finalTree = (await readProgress()).questionPath;
    expect(finalTree.find(q => q.text.includes("再追一层"))?.parentId).toBe(firstBranch.id);
    const savedInput = { questionId: originalQuestion.id, content: "重复提交", mode: "followup", clientRequestId: "9011b162-aebd-4b5f-a3e1-5473cff70233" };
    const submitted = await app.inject({ method: "POST", url: "/api/bible-study/answer", headers: member, payload: savedInput });
    expect(submitted.statusCode).toBe(202);
    const duplicate = await app.inject({ method: "POST", url: "/api/bible-study/answer", headers: member, payload: savedInput });
    expect(duplicate.statusCode).toBe(202);
    await expect.poll(async () => (await readProgress()).questionPath.length).toBe(finalTree.length + 1);
    const foreignAnswer = await app.inject({ method: "POST", url: "/api/bible-study/answer", headers: admin, payload: { ...savedInput, clientRequestId: "9a31d45d-ffbc-4536-96ab-aaf520204ca2" } });
    expect(foreignAnswer.statusCode).toBe(409);
    const invalidEvidence = await app.inject({ method: "POST", url: "/api/bible-study/answer", headers: member, payload: { ...savedInput, evidence: "诗篇 23:1", clientRequestId: "9a31d45d-ffbc-4536-96ab-aaf520204ca2" } });
    expect(invalidEvidence.statusCode).toBe(409);
    await page.reload();
    await closeBibleWorkspace(page);
    await page.getByRole("button", { name: "围绕第38节提问", exact: true }).click();
    await expect(page.locator(".selected-passage")).toContainText("耶稣");
    const inline = page.locator(".inline-questions");
    await expect(inline).toContainText("问题列表");
    for (const width of [360, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.locator(".study-workspace").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      const field = inline.getByPlaceholder("写下你的观察…");
      await expect(field).toBeVisible();
      expect((await field.boundingBox())!.width).toBeGreaterThan(width < 760 ? 230 : 350);
      if (width < 760) await expect.poll(() => page.locator(".channel-pane").evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
      await inline.locator(".question-detail").scrollIntoViewIfNeeded();
      if (width === 390 || width === 1280) await page.screenshot({ path: testInfo.outputPath(`study-inline-${width}.png`), animations: "disabled" });
    }
    await page.getByRole("button", { name: "收起问答", exact: true }).click();
    await expect(inline.locator("textarea")).toHaveCount(0);
    await expect(inline.getByRole("button", { name: `继续追问 ${rootLabel}`, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "展开问答", exact: true }).click();
    await expect(inline.locator("textarea")).toBeVisible();

    const replies = [
      ["这段借着平静风浪显出耶稣的权柄。", "interpret"],
      ["基督在十字架舍命，显明他顾念我们。", "gospel"],
      ["在报告不顺利时，我会怕同事看轻而隐藏问题。", "situation"],
      ["基督已经接纳我，让我不必靠表现保证自己的价值。", "grace"]
    ];
    failures = 1; // The first follow-up succeeds after one automatic retry.
    for (const [response, stage] of replies) {
      await send(response);
      await waitFor(`继续思考 ${stage}`);
    }
    await send("下次报告不顺利，我会如实说明卡住的地方，再请同事帮忙。");
    await waitFor("小结已归档");
    const archive = await request.get("/api/bible-study/summaries", { headers: member });
    expect((await archive.json() as BibleStudyRecordPage).records[0]).toMatchObject({ summary: true, sender: "查经助手" });
    expect((await records()).filter(row => row.content.includes("你的答复已经保存"))).toHaveLength(1);

    await page.reload();
    await expect(page.getByTestId("active-channel-name")).toHaveText("同行书房");
    await focusChat(page);
    await expect(page.getByRole("heading", { name: "本次查经已完成" })).toBeVisible();
    for (const width of [360, 390, 1280]) {
      await page.setViewportSize({ width, height: 850 });
      const button = page.getByRole("button", { name: "查经小结", exact: true });
      await expect(button).toBeVisible();
      await button.click({ timeout: 5000 });
      const dialog = page.getByRole("dialog", { name: "查经小结" });
      await expect(dialog.getByText(summary.takeaway)).toBeVisible();
      const close = dialog.getByRole("button", { name: "关闭", exact: true });
      const box = await close.boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= width).toBe(true);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    }

    await send("诗篇 23");
    await waitFor("诗篇 第23章");
    const beforeNewContext = calls.length;
    await send("作者称耶和华为牧者。");
    await expect.poll(() => calls.length).toBe(beforeNewContext + 1);
    const newContext = calls.at(-1)!.map(message => message.content).join("\n");
    expect(newContext).toContain("诗篇");
    expect(newContext).not.toContain("独立上下文标记");
    expect(newContext).not.toContain(summary.takeaway);
    await waitFor("作者称耶和华为牧者。");

    await page.evaluate(token => localStorage.setItem("team-chat-token", token), admin.Authorization.replace("Bearer ", ""));
    await page.goto("/log");
    await page.getByRole("button", { name: "同行书房", exact: true }).click();
    await page.getByRole("button", { name: new RegExp(E2E_MEMBER.displayName) }).click();
    await expect(page.getByText(/独立上下文标记/)).toBeVisible();

    const reception = await app.inject({
      method: "POST", url: "/api/reception/rooms", headers: admin,
      payload: { name: "查经访客测试", code: "访客查经口令", durationHours: 1 }
    });
    expect(reception.statusCode).toBe(200);
    const receptionId = reception.json().channel.id as number;
    const guest = await app.inject({ method: "POST", url: "/api/reception/join", payload: { code: "访客查经口令", displayName: "临时查经访客" } });
    expect(guest.statusCode).toBe(200);
    const guestHeaders = { Authorization: `Bearer ${guest.json().token}` };
    const guestEntry = await app.inject({
      method: "POST", url: "/api/messages", headers: guestHeaders,
      payload: { channelId: receptionId, content: "@查经助手 诗篇 23" }
    });
    expect(guestEntry.statusCode).toBe(200);
    const guestStudyId = guestEntry.json().enteredChannelId as number;
    expect(guestStudyId).toBeGreaterThan(0);
    const guestLog = `/api/admin/bible-study/rooms/${guestStudyId}`;
    await expect.poll(async () => {
      const result = await app.inject({ method: "GET", url: guestLog, headers: admin });
      return result.json<BibleStudyRecordPage>().records.some(record => record.content.includes("哪一句话或哪一个细节"));
    }).toBe(true);
    const closeReception = await app.inject({ method: "DELETE", url: `/api/reception/rooms/${receptionId}`, headers: admin });
    expect(closeReception.statusCode, closeReception.body).toBe(200);
    const savedGuestStudy = await app.inject({ method: "GET", url: guestLog, headers: admin });
    expect(savedGuestStudy.json<BibleStudyRecordPage>().records).toEqual(expect.arrayContaining([
      expect.objectContaining({ sender: "临时查经访客", content: "诗篇 23" })
    ]));
  } finally {
    await app.inject({ method: "POST", url: "/api/admin/ai-settings", headers: admin, payload: { clearApiKey: true } });
    globalThis.fetch = originalFetch;
    await app.close();
  }
});

test("WebKit keeps deep branches and the full-width composer when selecting a verse range", async ({ playwright, request }, testInfo) => {
  const admin = await authFor(request, E2E_ADMIN);
  const entry = await request.post("/api/bible-study/enter", { headers: admin });
  expect(entry.ok()).toBe(true);
  const { channelId } = await entry.json() as { channelId: number };
  const browser = await playwright.webkit.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const page = await context.newPage();
  const progress: BibleStudyProgress = {
    stage: "observe", reference: "马可福音 14:37-39", questions: 61, feedback: null, working: false, failure: null,
    reading: { title: "马可福音 14:37-39", question: "看见了什么？", paragraphs: [[
      { number: "37", text: "耶稣回来，见他们睡着了。" },
      { number: "38", text: "总要警醒祷告，免得入了迷惑。你们心灵固然愿意，肉体却软弱了。" },
      { number: "39", text: "耶稣又去祷告，说的话还是与先前一样。" }
    ]] },
    questionPath: Array.from({ length: 61 }, (_, i) => ({
      id: i + 1, stage: "observe", text: `第${i + 1}个观察问题？`, purpose: "找出经文中的动作。",
      relation: i ? "deepen" : "opening", ...(i ? { parentId: i === 60 ? 7 : i } : {}), evidence: ["马可福音 14:38"]
    })),
    answers: [{ id: 101, questionId: 8, text: "警醒祷告。", response: "这两个动作怎样联系？" }]
  };
  try {
    await page.route("**/*", route => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await page.route("**/api/bible-study/progress", route => route.fulfill({ json: { progress, latest: null } }));
    const submissions: unknown[] = [];
    await page.route("**/api/bible-study/answer", route => {
      submissions.push(route.request().postDataJSON());
      return route.fulfill({ status: 202, json: { accepted: true } });
    });
    await page.addInitScript(({ token, channelId }) => {
      localStorage.setItem("team-chat-token", token);
      localStorage.setItem("team-chat-current-channel", String(channelId));
    }, { token: admin.Authorization.replace("Bearer ", ""), channelId });
    await page.goto("/");
    await closeBibleWorkspace(page);
    await expect(page.getByTestId("active-channel-name")).toHaveText("同行书房");
    const path = page.getByRole("region", { name: "问题脉络" });
    await expect(path.locator(".question-number").filter({ hasText: /^q61$/ })).toHaveCount(1);
    await path.getByRole("button", { name: "继续追问 q60", exact: true }).click();
    await expect(path.locator(".parent-question")).toContainText("q59");
    await page.getByRole("button", { name: "选择一段", exact: true }).click();
    await page.getByRole("button", { name: "围绕第37节提问", exact: true }).click();
    await page.getByRole("button", { name: "围绕第38节提问", exact: true }).click();
    await expect(page.locator(".selected-passage sup")).toHaveCount(2);
    const field = path.getByPlaceholder("还想从这个问题追问什么？");
    await field.fill("从这里再看一个细节");
    await expect(path.locator("label")).toContainText("马可福音 14:37-38");
    for (const width of [360, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.locator(".study-workspace").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect((await field.boundingBox())!.width).toBeGreaterThan(width < 760 ? 230 : 350);
    }
    await path.getByRole("button", { name: "发起追问", exact: true }).click();
    expect(submissions).toEqual([expect.objectContaining({ questionId: 60, mode: "followup", content: "从这里再看一个细节", evidence: "马可福音 14:37-38" })]);
    await expect(field).toHaveCount(0);
    await expect(path.locator(".question-number")).toHaveCount(61);
    await path.getByRole("button", { name: "已回答 · 查看回答", exact: true }).click();
    await expect(path.locator(".saved-answers")).toContainText("警醒祷告。");
    await expect(path.locator(".saved-answers")).toContainText("这两个动作怎样联系？");
    await page.screenshot({ path: testInfo.outputPath("study-webkit-collapsed.png"), animations: "disabled" });
  } finally { await context.close(); await browser.close(); }
});
