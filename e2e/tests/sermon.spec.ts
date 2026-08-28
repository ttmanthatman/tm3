import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { E2E_ADMIN, E2E_CHANNELS, E2E_MEMBER } from "../seed-data.js";

async function blockPublicNetwork(page: Page) {
  await page.route("**/*", async (route) => {
    const hostname = new URL(route.request().url()).hostname;
    if (hostname === "127.0.0.1" || hostname === "localhost") {
      await route.continue();
      return;
    }
    await route.abort("blockedbyclient");
  });
}

async function readChatSocket(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector("#app") as HTMLElement & { __vue_app__?: { _context?: { provides?: Record<PropertyKey, unknown> } } };
    const provides = root?.__vue_app__?._context?.provides;
    const pinia = Reflect.ownKeys(provides || {}).map((key) => provides?.[key]).find((value) => value && typeof value === "object" && "_s" in value) as
      | { _s?: Map<string, Record<string, unknown>> }
      | undefined;
    const store = [...(pinia?._s?.values() || [])].find((candidate) => "connectionState" in candidate && "socket" in candidate);
    const socket = store?.socket as { connected?: boolean } | undefined;
    return { socketFound: Boolean(socket), connected: socket?.connected === true };
  });
}

async function waitForChatSocket(page: Page) {
  await expect.poll(() => readChatSocket(page).then((state) => state.connected)).toBe(true);
}

async function login(page: Page, account: { username: string; password: string }) {
  await page.goto("/");
  await page.getByPlaceholder("用户名").fill(account.username);
  await page.getByPlaceholder("密码").fill(account.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
  await waitForChatSocket(page);
}

async function openSermonWorkspace(page: Page) {
  await page.getByRole("button", { name: "更多功能" }).click();
  const tile = page.getByRole("button", { name: "讲道台", exact: true });
  await expect(tile).toBeVisible();
  await tile.click();
  const workspace = page.locator(".sermon-workspace.open");
  await expect(workspace).toBeVisible();
  return workspace;
}

async function adminToken(request: APIRequestContext) {
  const response = await request.post("/api/auth/login", {
    data: { username: E2E_ADMIN.username, password: E2E_ADMIN.password, deviceName: "sermon-e2e-setup" }
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { token: string };
  return body.token;
}

test.beforeAll(async ({ request }) => {
  const token = await adminToken(request);
  const created = await request.post("/api/admin/accounts", {
    headers: { Authorization: `Bearer ${token}` },
    data: { username: E2E_MEMBER.username, displayName: E2E_MEMBER.displayName, password: E2E_MEMBER.password }
  });
  expect(created.ok()).toBe(true);
});

test.afterAll(async ({ request }) => {
  const token = await adminToken(request);
  const headers = { Authorization: `Bearer ${token}` };
  const list = await request.get("/api/admin/accounts", { headers });
  const body = (await list.json()) as { accounts: Array<{ id: number; username: string }> };
  const member = body.accounts.find((account) => account.username === E2E_MEMBER.username);
  if (member) {
    await request.delete(`/api/admin/accounts/${member.id}`, { headers });
  }
});

test("讲道经文负一屏演示、标注与显示设置同步（双端）", async ({ browser }) => {
  test.setTimeout(120_000);
  // 讲道者端先走移动端单栏流程（演示视图含标注交互），桌面双栏布局在后段单独检查。
  const adminContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const viewerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const admin = await adminContext.newPage();
  const viewer = await viewerContext.newPage();
  await blockPublicNetwork(admin);
  await blockPublicNetwork(viewer);

  // 弱网约束抽查：展示激活前观众端不应请求任何 sermon 相关 chunk（懒加载）。
  const sermonChunkRequests: string[] = [];
  viewer.on("request", (request) => {
    const url = request.url();
    if (/Sermon(Overlay|Workspace|Stage|RequestCard)/.test(url)) sermonChunkRequests.push(url);
  });

  try {
    await login(admin, E2E_ADMIN);
    await login(viewer, E2E_MEMBER);
    expect(sermonChunkRequests).toEqual([]);

    // 从“更多”抽屉进入负一屏讲道台，频道/聊天面板被工作区顶替。
    const workspace = await openSermonWorkspace(admin);
    await expect(admin.locator(".chat-pane")).toHaveCount(0);
    await expect(workspace.locator(".sermon-queue-view")).toBeVisible();

    await workspace.locator(".sermon-reference-input").fill("约3:16；诗篇23:1");
    // 统一输入框默认整段一屏；勾选「每处经文一屏」让两处出处各自独立成屏。
    await workspace.getByRole("checkbox", { name: "每处经文一屏" }).check();
    const addButton = workspace.getByRole("button", { name: "加入队列", exact: true });
    await expect(addButton).toBeEnabled();
    await addButton.click();
    await expect(workspace.locator(".sermon-queue-item")).toHaveCount(2);
    await admin.screenshot({ path: "output/e2e/sermon/presenter-queue.png" });

    // 队列屏点击条目：进入演示视图并推送给观众。
    const firstItem = workspace.locator(".sermon-queue-item").filter({ hasText: "约翰福音 3:16" });
    await firstItem.locator(".sermon-queue-main").click();
    const presentView = workspace.locator(".sermon-present-view");
    await expect(presentView).toBeVisible();

    const overlay = viewer.locator(".sermon-overlay");
    await expect(overlay).toBeVisible();
    await expect(overlay.locator(".sermon-overlay-badge")).toHaveText(/约翰福音\s*3:16/);
    await expect(overlay).toContainText("神爱世人");
    await viewer.screenshot({ path: "output/e2e/sermon/overlay-390.png" });
    await expect.poll(() => sermonChunkRequests.some((url) => url.includes("SermonOverlay"))).toBe(true);

    // 讲道者演示视图与观众端经文渲染逐字一致（共用 SermonStage）。
    const stagePassage = presentView.locator(".sermon-passage");
    await expect(stagePassage).toBeVisible();
    const overlayText = await overlay.locator(".sermon-passage").innerText();
    await expect(stagePassage).toHaveText(overlayText);

    // 演示视图内点击经节弹出标注菜单，整节高亮同步到观众端。
    await stagePassage.locator(".sermon-verse").first().click();
    const verseMenu = admin.locator(".sermon-verse-menu");
    await expect(verseMenu).toBeVisible();
    await verseMenu.getByRole("button", { name: "高亮", exact: true }).click();
    await expect(overlay.locator(".sermon-highlight").first()).toBeVisible();

    // 演示视图内选中节内文字后点“划线选段”，观众端同步出现选段划线。
    await admin.evaluate(() => {
      const el = document.querySelector<HTMLElement>(".sermon-present-stage .sermon-verse-text");
      if (!el) throw new Error("找不到演示视图经文");
      const firstText = (node: Node): Node | null => {
        if (node.nodeType === Node.TEXT_NODE && node.textContent) return node;
        for (const child of Array.from(node.childNodes)) {
          const found = firstText(child);
          if (found) return found;
        }
        return null;
      };
      const textNode = firstText(el);
      if (!textNode?.textContent || textNode.textContent.length < 4) throw new Error("经文文本为空");
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, 4);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    const selectionButton = admin.locator(".sermon-selection-btn");
    await expect(selectionButton).toBeVisible();
    await selectionButton.click();
    await expect(overlay.locator(".sermon-underline").first()).toHaveText(/神爱世/);
    await admin.screenshot({ path: "output/e2e/sermon/presenter-stage.png" });

    // 观众端 1280px 桌面宽度检查。
    await viewer.setViewportSize({ width: 1280, height: 844 });
    await expect(overlay).toBeVisible();
    await viewer.screenshot({ path: "output/e2e/sermon/overlay-1280.png" });
    await viewer.setViewportSize({ width: 390, height: 844 });

    // 控制栏“下一条”切换 sermon:present，观众端同步切换。
    await presentView.getByRole("button", { name: "下一条", exact: true }).click();
    await expect(overlay.locator(".sermon-overlay-badge")).toHaveText(/诗篇\s*23:1/);
    await expect(overlay).toContainText("耶和华是我的牧者");

    // 观众最小化为浮动条；讲道者切回上一条时观众端自动展开。
    await viewer.getByRole("button", { name: "最小化讲道经文" }).click();
    await expect(viewer.locator(".sermon-mini-bar")).toBeVisible();
    await expect(overlay).toHaveCount(0);
    await presentView.getByRole("button", { name: "上一条", exact: true }).click();
    await expect(overlay).toBeVisible();
    await expect(overlay.locator(".sermon-overlay-badge")).toHaveText(/约翰福音\s*3:16/);
    // 等待讲道者端过渡动画完成，后续截图才不会抓到老条目的淡出帧。
    await expect(stagePassage).toContainText("神爱世人");

    // 控制栏字体倍率 +0.2，观众端经文同步放大（每次点击后等待广播回环再调下一次）。
    await presentView.getByRole("button", { name: "增大字体" }).click();
    await expect(presentView.locator(".sermon-font-stepper")).toContainText("1.1×");
    await presentView.getByRole("button", { name: "增大字体" }).click();
    await expect(presentView.locator(".sermon-font-stepper")).toContainText("1.2×");
    await expect
      .poll(() => overlay.evaluate((el) => (el as HTMLElement).style.getPropertyValue("--sermon-font-scale")))
      .toBe("1.2");

    // 显示设置（字体族/背景/边距）经 sermon:display 同步到观众端舞台根元素。
    await presentView.getByRole("combobox", { name: "经文字体" }).selectOption("songti");
    await expect(overlay).toHaveAttribute("data-sermon-font", "songti");
    await expect(admin.locator(".sermon-present-stage")).toHaveAttribute("data-sermon-font", "songti");
    await presentView.getByRole("button", { name: "纯黑", exact: true }).click();
    await expect(overlay).toHaveAttribute("data-sermon-bg", "midnight");
    await expect(overlay).toHaveCSS("background-color", "rgb(0, 0, 0)");
    await presentView.locator('.sermon-margin-slider input[type="range"]').fill("10");
    await expect
      .poll(() => overlay.evaluate((el) => (el as HTMLElement).style.getPropertyValue("--sermon-margin-pct")))
      .toBe("10");
    // 边距机制：卡片内正文容器按卡片宽度的百分比内缩（桌面端卡片封顶后同样生效）。
    await expect
      .poll(async () =>
        overlay.locator(".sermon-overlay-body").evaluate((el) => {
          const card = el.closest(".sermon-overlay-card");
          if (!card) return -1;
          return parseFloat(getComputedStyle(el).paddingLeft) / card.getBoundingClientRect().width;
        })
      )
      .toBeCloseTo(0.1, 1);
    await viewer.screenshot({ path: "output/e2e/sermon/overlay-display-390.png" });

    // 桌面端（≥1024px）双栏布局：左列队列与演示控制，右列投影/手机双预览实时同步。
    await admin.setViewportSize({ width: 1440, height: 900 });
    await expect(presentView).toBeHidden();
    await expect(workspace.locator(".sermon-queue-column")).toBeVisible();
    await expect(workspace.locator(".sermon-queue-controls")).toBeVisible();
    const projectorPreview = workspace.locator(".sermon-preview-stage.projector");
    const phonePreview = workspace.locator(".sermon-preview-stage.phone");
    await expect(projectorPreview).toBeVisible();
    await expect(phonePreview).toBeVisible();
    await expect(projectorPreview).toContainText("神爱世人");
    await expect(phonePreview).toContainText("神爱世人");
    await expect(projectorPreview).toHaveAttribute("data-sermon-font", "songti");
    await expect(projectorPreview).toHaveAttribute("data-sermon-bg", "midnight");
    await expect(phonePreview).toHaveAttribute("data-sermon-font", "songti");
    await admin.screenshot({ path: "output/e2e/sermon/presenter-desktop-1440.png" });
    await admin.setViewportSize({ width: 390, height: 844 });
    await expect(presentView).toBeVisible();

    // 自由文字条目：统一输入框不解析经文，整段文字原样入屏并推送给观众。
    await presentView.getByRole("button", { name: "返回演示队列", exact: true }).click();
    await workspace.locator(".sermon-reference-input").fill("证道大纲\n一、神的爱\n\n二、人的回应");
    const textAddButton = workspace.getByRole("button", { name: "加入队列", exact: true });
    await expect(textAddButton).toBeEnabled();
    await textAddButton.click();
    await expect(workspace.locator(".sermon-queue-item")).toHaveCount(3);
    const textItem = workspace.locator(".sermon-queue-item").filter({ hasText: "文字分享" });
    await expect(textItem).toContainText("文字");
    await textItem.locator(".sermon-queue-main").click();
    await expect(overlay.locator(".sermon-overlay-badge")).toHaveText("文字分享");
    await expect(overlay).toContainText("证道大纲");
    await expect(overlay).toContainText("一、神的爱");
    await expect(overlay).toContainText("二、人的回应");
    await viewer.screenshot({ path: "output/e2e/sermon/overlay-text-390.png" });

    // 移动端 390px：演示视图控制栏全宽不溢出。
    await admin.setViewportSize({ width: 390, height: 844 });
    await expect(presentView.getByRole("button", { name: "结束展示", exact: true })).toBeVisible();
    await admin.screenshot({ path: "output/e2e/sermon/presenter-stage-390.png" });

    // 结束展示后观众端覆盖层消失，讲道者回到队列屏且队列已清空。
    admin.once("dialog", (dialog) => dialog.accept());
    await presentView.getByRole("button", { name: "结束展示", exact: true }).click();
    await expect(overlay).toHaveCount(0);
    await expect(viewer.locator(".sermon-mini-bar")).toHaveCount(0);
    await expect(workspace.locator(".sermon-queue-view")).toBeVisible();
    await expect(workspace.locator(".sermon-queue-item")).toHaveCount(0);
  } finally {
    await adminContext.close();
    await viewerContext.close();
  }
});

test("讲道权限申请卡：发送、批准与获批提示", async ({ browser }) => {
  test.setTimeout(60_000);
  const adminContext = await browser.newContext();
  const memberContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const admin = await adminContext.newPage();
  const member = await memberContext.newPage();
  await blockPublicNetwork(admin);
  await blockPublicNetwork(member);

  try {
    await login(admin, E2E_ADMIN);
    await login(member, E2E_MEMBER);

    await member.locator(".composer-main textarea").fill("/申请演讲 想带领查经");
    await member.getByRole("button", { name: "发送", exact: true }).click();

    const memberCard = member.locator(".sermon-request-card");
    await expect(memberCard).toBeVisible();
    await expect(memberCard).toContainText("待审批");
    await expect(memberCard).toContainText("想带领查经");

    const adminCard = admin.locator(".sermon-request-card");
    await expect(adminCard).toBeVisible();
    await expect(adminCard).toContainText("待审批");
    await adminCard.screenshot({ path: "output/e2e/sermon/request-card.png" });

    await adminCard.getByRole("button", { name: "批准", exact: true }).click();
    await adminCard.getByRole("button", { name: "7 天", exact: true }).click();
    await expect(adminCard).toContainText("已批准");
    await expect(memberCard).toContainText("已批准");

    // 申请人收到获批提示，之后“更多”抽屉出现讲道台入口。
    await expect(member.locator(".sermon-decision-toast")).toContainText("已批准");
    await member.getByRole("button", { name: "更多功能" }).click();
    await expect(member.getByRole("button", { name: "讲道台", exact: true })).toBeVisible();
  } finally {
    await adminContext.close();
    await memberContext.close();
  }
});
