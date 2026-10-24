import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import type { AiSettingsDTO, ChannelDTO, MessageDTO } from "../../src/shared/types.js";
import type { AssistantToolsSettingsDTO } from "../../src/shared/assistantTools.js";
import { QUESTION_ASSISTANT_MEDIA_PROTOCOL } from "../../src/shared/virtualCharacters.js";
import { E2E_ADMIN, E2E_CHANNELS } from "../seed-data.js";
import { focusChat } from "../helpers/chat.js";

test.use({ serviceWorkers: "block" });
test.setTimeout(120_000);

test("editable base prompts, activation expiry, private replies, stop stamps and AI logs persist", async ({ page, request }) => {
  const database = new URL(process.env.DATABASE_URL || "invalid:");
  if (process.env.E2E_TEST_RUN !== "1" || process.env.NODE_ENV !== "test" || database.protocol !== "mysql:"
    || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(database.hostname) || database.pathname !== "/tm3_e2e")
    throw new Error("Virtual-role fixtures require the isolated local tm3_e2e runner.");
  const prisma = new PrismaClient();
  // Exercise the real asynchronous server wiring with an offline model. The browser
  // reads the same disposable database through the normal E2E server after reload.
  const { buildApp } = await import("../../src/server/index.js");
  const app = await buildApp({ runStartupTasks: false });
  const originalFetch = globalThis.fetch;
  const calls: Array<Array<{ role: string; content: string }>> = [];
  let holdNext = false;
  let toolMode = false;
  let release: (() => void) | undefined;
  let releaseInitialSettings: (() => void) | undefined;
  globalThis.fetch = async (input, init) => {
    if (!String(input).startsWith("https://api.deepseek.com/")) return originalFetch(input, init);
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
    calls.push(body.messages);
    if (holdNext) {
      holdNext = false;
      await new Promise<void>(resolve => { release = resolve; });
    }
    const toolResult = body.messages.some(message => message.role === "user" && message.content.startsWith("功能 open_feature 的执行结果"));
    const content = body.messages[0].content === "TEST_JUDGE" ? "yes"
      : toolMode && !toolResult ? JSON.stringify({ kind: "call_tool", name: "open_feature", arguments: { feature: "help" } })
      : body.messages[0].content.includes("GENERIC_PERSONA") ? "通用角色私聊回答"
      : JSON.stringify({ kind: "reply", text: `离线回答 ${calls.length}`, items: [], scoreIds: [] });
    return Response.json({ choices: [{ message: { content } }] });
  };
  let headers: { Authorization: string } | undefined;
  try {
    const sentSocketFrames: string[] = [];
    page.on("websocket", socket => socket.on("framesent", frame => sentSocketFrames.push(String(frame.payload))));
    await page.route("**/*", route => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await page.goto("/");
    await page.getByPlaceholder("用户名").fill(E2E_ADMIN.username);
    await page.getByPlaceholder("密码").fill(E2E_ADMIN.password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
    headers = { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem("team-chat-token"))}` };
    const authHeaders = headers;
    const suffix = randomUUID().slice(0, 8);
    const name = `所罗没门${suffix}`;
    const systemPrompt = `TEST_BASE_${suffix}\n${QUESTION_ASSISTANT_MEDIA_PROTOCOL}`;
    const initial = await request.post("/api/admin/ai-settings", { headers, data: { aiRoles: [{ username: "ai_slmm", displayName: name, enabled: true, questionTriggerEnabled: true }] } });
    expect(initial.ok()).toBe(true);
    const assistant = await prisma.actor.findUniqueOrThrow({ where: { username: "ai_slmm" }, include: { character: true } });

    let holdInitialSettings = true;
    const initialSettingsReady = new Promise<void>(resolve => { releaseInitialSettings = resolve; });
    await page.route("**/api/admin/ai-settings", async route => {
      if (route.request().method() === "GET" && holdInitialSettings) await initialSettingsReady;
      await route.continue();
    });
    await page.goto("/ai-settings");
    await page.getByRole("button", { name: /虚拟角色.*人设/ }).click();
    const panel = page.getByRole("region", { name: `${name} 的提示与激活设置` });
    // An initial settings response must never overwrite edits made against the role list.
    await expect(panel.getByLabel("底层系统提示", { exact: true })).toBeDisabled();
    await expect(panel.getByRole("button", { name: "保存角色设置", exact: true })).toBeDisabled();
    holdInitialSettings = false;
    releaseInitialSettings?.();
    await expect(panel.getByLabel("底层系统提示", { exact: true })).toBeEnabled();
    await panel.getByLabel("底层系统提示", { exact: true }).fill(systemPrompt);
    await panel.getByLabel("激活判断提示", { exact: true }).fill("TEST_JUDGE");
    await panel.getByLabel("激活保持时间（分钟）", { exact: true }).fill("3");
    await panel.getByLabel("回答参考时间（分钟）", { exact: true }).fill("10");
    for (const width of [360, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const prompt = panel.getByLabel("底层系统提示", { exact: true });
      await prompt.scrollIntoViewIfNeeded();
      const box = await prompt.boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x || 0) + (box?.width || 0)).toBeLessThanOrEqual(width);
    }
    const saved = page.waitForResponse(response => response.url().endsWith("/api/admin/ai-settings") && response.request().method() === "POST");
    await panel.getByRole("button", { name: "保存角色设置", exact: true }).click();
    expect((await saved).ok()).toBe(true);
    await page.reload();
    await page.getByRole("button", { name: /虚拟角色.*人设/ }).click();
    await expect(panel.getByLabel("底层系统提示", { exact: true })).toHaveValue(systemPrompt);
    await expect(panel.getByLabel("激活保持时间（分钟）", { exact: true })).toHaveValue("3");
    const settings = (await (await request.get("/api/admin/ai-settings", { headers })).json()) as AiSettingsDTO;
    expect(settings.aiRoles?.find(role => role.username === "ai_slmm")).toMatchObject({ systemPrompt, activationDurationMinutes: 3, contextWindowMinutes: 10 });

    // Function settings are independent of the enclosing AI-settings form and survive reload.
    await page.getByRole("button", { name: /^功能调用/ }).click();
    const toolsPanel = page.getByRole("region", { name: "AI 助手功能调用", exact: true });
    const toolsEnabled = toolsPanel.getByLabel("允许 AI 助手调用聊天室功能");
    const toolsLimit = toolsPanel.getByLabel("每次回答最多调用次数");
    await expect(toolsEnabled).toBeChecked();
    await expect(toolsPanel).toContainText("新注册的功能自动可用，无需逐项配置");
    await expect(toolsPanel.getByRole("region", { name: "可用功能目录" })).toContainText("open_feature");
    async function saveTools(viaEnter = false) {
      const response = page.waitForResponse(result => result.url().endsWith("/api/admin/assistant-tools") && result.request().method() === "POST");
      if (viaEnter) await toolsLimit.press("Enter");
      else await toolsPanel.getByRole("button", { name: "保存功能调用设置", exact: true }).click();
      expect((await response).ok()).toBe(true);
      await expect(toolsPanel.getByRole("status")).toHaveText("功能调用设置已保存");
    }
    await toolsLimit.fill("13");
    await expect(toolsPanel.getByRole("button", { name: "保存功能调用设置", exact: true })).toBeDisabled();
    await toolsLimit.fill("2");
    await toolsEnabled.uncheck();
    await saveTools(true);
    await page.reload();
    await page.getByRole("button", { name: /^功能调用/ }).click();
    await expect(toolsEnabled).not.toBeChecked();
    await expect(toolsLimit).toHaveValue("2");
    await expect(toolsPanel).toContainText("功能调用已关闭");
    await toolsEnabled.check();
    await toolsLimit.fill("3");
    await saveTools();
    await page.reload();
    await page.getByRole("button", { name: /^功能调用/ }).click();
    await expect(toolsEnabled).toBeChecked();
    await expect(toolsLimit).toHaveValue("3");
    const toolsSettings = await request.get("/api/admin/assistant-tools", { headers });
    expect(toolsSettings.ok()).toBe(true);
    expect(await toolsSettings.json() as AssistantToolsSettingsDTO).toMatchObject({ enabled: true, maxCalls: 3,
      functions: expect.arrayContaining([expect.objectContaining({ name: "open_feature", kind: "present" })]) });

    // The ordinary chat menu exposes the same sunset help window on phones and desktop.
    await page.goto("/");
    await focusChat(page);
    const toolsTrigger = page.getByRole("button", { name: "更多管理功能", exact: true });
    const help = page.getByRole("dialog", { name: "使用说明", exact: true });
    for (const width of [360, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await toolsTrigger.click();
      await page.getByRole("menuitem", { name: "使用说明", exact: true }).click();
      await expect(help.getByText("还没写呢，你随便涂涂画画吧……", { exact: true })).toBeVisible();
      await expect(page.getByRole("menu", { name: "聊天管理功能" })).toHaveCount(0);
      const window = help.locator(".chat-usage-help");
      const box = await window.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(900);
      expect(await window.evaluate(element => getComputedStyle(element).backgroundImage)).toContain("linear-gradient");
      if (width === 390) await help.getByRole("button", { name: "关闭", exact: true }).click();
      else await page.keyboard.press("Escape");
      await expect(help).toBeHidden();
      await expect(toolsTrigger).toBeFocused();
    }

    expect((await app.inject({ method: "POST", url: "/api/admin/ai-settings", headers, payload: { apiKey: "offline-e2e-key" } })).statusCode).toBe(200);
    const dmResponse = await request.post("/api/direct-virtual-channels", { headers, data: { username: "ai_slmm" } });
    expect(dmResponse.ok()).toBe(true);
    const dm = (await dmResponse.json()).channel as ChannelDTO;
    // Keep activation anchors independent from earlier media fixtures in the same suite.
    const chatResponse = await request.post("/api/channels", { headers, data: { name: `虚拟角色回归${suffix}` } });
    expect(chatResponse.ok()).toBe(true);
    const chat = (await chatResponse.json()).channel as ChannelDTO;
    async function send(channelId: number, content: string) {
      const response = await app.inject({ method: "POST", url: "/api/messages", headers: authHeaders, payload: { channelId, content, type: "text" } });
      expect(response.statusCode).toBe(200);
      return response.json().message as MessageDTO;
    }
    const replies = (triggerId: number) => prisma.message.findMany({ where: { replyToId: triggerId, senderActorId: assistant.id }, orderBy: { id: "asc" } });
    const question = await send(dm.id, `私聊问候${suffix}`); // No mention or question mark.
    await expect.poll(async () => (await replies(question.id)).length).toBe(1);
    expect(calls.some(messages => messages[1]?.content === systemPrompt)).toBe(true);
    const answer = (await replies(question.id))[0];
    const stop = await send(dm.id, `@${name} 你去买酱油吧`);
    await expect.poll(async () => (await prisma.message.findUniqueOrThrow({ where: { id: answer.id } })).payload).toMatchObject({ aiSessionEnded: { byMessageId: stop.id } });
    expect(await replies(stop.id)).toHaveLength(0);

    holdNext = true;
    const slow = await send(dm.id, "这是一条等待关闭的消息");
    await expect.poll(() => !!release).toBe(true);
    await send(dm.id, "你去睡觉吧");
    release?.();
    release = undefined;
    const restarted = await send(dm.id, "重新开始聊天");
    await expect.poll(async () => (await replies(restarted.id)).length).toBe(1);
    expect(await replies(slow.id)).toHaveLength(0);

    // An expired activation stays silent even though the answer history is valid for 10 minutes.
    const anchor = await send(chat.id, `@${name} 帮我回答${suffix}`);
    await expect.poll(async () => (await replies(anchor.id)).length).toBe(1);
    const follow = await send(chat.id, "继续补充这个问题");
    await expect.poll(async () => (await replies(follow.id)).length).toBe(1);
    expect((await replies(follow.id))[0].payload).toMatchObject({ aiActivationMode: "weak", activationAnchorMessageId: anchor.id });
    await prisma.message.update({ where: { id: anchor.id }, data: { createdAt: new Date(Date.now() - 4 * 60_000) } });
    const before = calls.length;
    const quiet = await send(chat.id, "这是一条普通补充");
    // A subsequent direct request completes after the ordinary message's anchor lookup.
    const next = await send(chat.id, `@${name} 现在重新提问`);
    await expect.poll(async () => (await replies(next.id)).length).toBe(1);
    expect(calls.length - before).toBe(1);
    expect(await replies(quiet.id)).toHaveLength(0);

    // Raw HTTP and rich-text trailing spaces suppress mentions, questions and active private sessions.
    const beforeOptOut = calls.length;
    const optedOut = [
      await send(chat.id, `@${name} HTTP尾空格也不要回答${suffix}？ `),
      await send(dm.id, `<p>@${name} 富文本尾空格也不要回答${suffix}？&nbsp;</p>`)
    ];
    for (const message of optedOut) {
      expect(message.payload).toMatchObject({ aiActivationSuppressed: true });
      expect((await prisma.message.findUniqueOrThrow({ where: { id: message.id } })).payload).toMatchObject({ aiActivationSuppressed: true });
    }
    const optOutBarrier = await send(chat.id, `@${name} 尾空格之后的正常问题${suffix}`);
    await expect.poll(async () => (await replies(optOutBarrier.id)).length).toBe(1);
    expect(calls.length - beforeOptOut).toBe(1);
    for (const message of optedOut) expect(await prisma.message.count({ where: { replyToId: message.id, sender: { kind: "virtual" } } })).toBe(0);

    const custom = `friend_${suffix}`;
    expect((await request.post("/api/virtual-characters", { headers, data: { username: custom, displayName: `朋友${suffix}`, config: { profile: { persona: "GENERIC_PERSONA" }, systemPrompt: "你是亲切的朋友。" } } })).ok()).toBe(true);
    const customDm = (await (await request.post("/api/direct-virtual-channels", { headers, data: { username: custom } })).json()).channel as ChannelDTO;
    const genericQuestion = await send(customDm.id, "一起读书吧");
    await expect.poll(() => prisma.message.count({ where: { replyToId: genericQuestion.id, content: "通用角色私聊回答" } })).toBe(1);

    // Generate an actual capability card through the model -> registered tool -> persisted message path.
    toolMode = true;
    const toolQuestion = await send(dm.id, `请把聊天室使用说明交给我${suffix}`);
    await expect.poll(async () => (await replies(toolQuestion.id)).length).toBe(2);
    toolMode = false;
    const toolReplies = await replies(toolQuestion.id);
    const toolCard = toolReplies.find(message => message.payload && typeof message.payload === "object" && "assistantActions" in message.payload);
    expect(toolCard).toBeDefined();
    expect(toolCard!.payload).toMatchObject({ assistantActions: [{ feature: "help", label: "打开使用说明" }] });
    expect(calls.some(messages => messages.some(message => message.role === "user" && message.content.startsWith("功能 open_feature 的执行结果")))).toBe(true);

    // Use the real MySQL query, then verify details and private labels in the browser.
    const logs = await request.get("/api/admin/activity-logs?category=ai", { headers });
    expect(logs.ok()).toBe(true);
    expect((await logs.json()).logs).toEqual(expect.arrayContaining([expect.objectContaining({ questionMessageId: question.id, answerMessageId: answer.id, questionText: question.content, isPrivateConversation: true })]));
    await page.goto("/log");
    await page.getByRole("button", { name: "AI 问答", exact: true }).click();
    const detail = page.locator(".ai-exchange-log").filter({ hasText: question.content });
    await expect(detail).toBeVisible();
    await expect(detail.getByText("私聊", { exact: true })).toBeVisible();
    for (const width of [360, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await detail.scrollIntoViewIfNeeded();
      const box = await detail.boundingBox();
      expect((box?.x || 0) + (box?.width || 0)).toBeLessThanOrEqual(width);
    }
    await page.goto("/");
    await focusChat(page);
    await page.locator(".channel-row").filter({ hasText: dm.name }).click();
    await expect(page.locator(`[data-message-id="${answer.id}"] .ai-session-ended-stamp`)).toBeVisible();
    await page.reload();
    await focusChat(page);
    await expect(page.locator(`[data-message-id="${answer.id}"] .ai-session-ended-stamp`)).toBeVisible();

    const featureButton = page.locator(`[data-message-id="${toolCard!.id}"]`).getByRole("button", { name: "打开使用说明", exact: true });
    await featureButton.click();
    await expect(help.getByText("还没写呢，你随便涂涂画画吧……", { exact: true })).toBeVisible();
    await help.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(help).toBeHidden();
    await expect(featureButton).toBeFocused();

    // Use the real composer and Socket.IO route, then verify the durable opt-out after reload.
    const socketText = `@${name} 输入框尾空格不要回答${suffix}？ `;
    const beforeSocket = calls.length;
    await page.locator(".composer-main textarea").fill(socketText);
    await page.getByRole("button", { name: "发送", exact: true }).click();
    const socketMessage = page.locator("[data-message-id]").filter({ hasText: socketText.trim() });
    await expect(socketMessage).toHaveCount(1);
    const socketMessageId = Number(await socketMessage.getAttribute("data-message-id"));
    expect(sentSocketFrames.some(frame => frame.includes('"message:send"') && frame.includes(JSON.stringify(socketText)))).toBe(true);
    expect((await prisma.message.findUniqueOrThrow({ where: { id: socketMessageId } })).payload).toMatchObject({ aiActivationSuppressed: true });
    const socketBarrier = await send(dm.id, `输入框尾空格之后正常回答${suffix}`);
    await expect.poll(async () => (await replies(socketBarrier.id)).length).toBe(1);
    expect(calls.length - beforeSocket).toBe(1);
    expect(await prisma.message.count({ where: { replyToId: socketMessageId, sender: { kind: "virtual" } } })).toBe(0);
    await page.reload();
    await focusChat(page);
    await expect(page.locator(`[data-message-id="${socketMessageId}"]`)).toBeVisible();
    expect((await prisma.message.findUniqueOrThrow({ where: { id: socketMessageId } })).payload).toMatchObject({ aiActivationSuppressed: true });
  } finally {
    releaseInitialSettings?.();
    release?.();
    if (headers) await app.inject({ method: "POST", url: "/api/admin/ai-settings", headers, payload: { clearApiKey: true } });
    globalThis.fetch = originalFetch;
    await app.close();
    await prisma.$disconnect();
  }
});
