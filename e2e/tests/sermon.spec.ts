import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { E2E_ADMIN, E2E_CHANNELS, E2E_MEMBER } from "../seed-data.js";

// 二期新增的自建账号（经 /api/admin/accounts 创建/删除）：第二个管理员用于并发演示互斥测试，
// 第二个普通成员用于集会授权测试（避免与权限申请卡测试已获批的 E2E_MEMBER 冲突）。
const E2E_ADMIN2 = {
  username: "e2e-admin2",
  displayName: "冒烟管理员二",
  password: "E2eAdmin123!"
} as const;

const E2E_MEMBER2 = {
  username: "e2e-member2",
  displayName: "冒烟用户二",
  password: "E2eMember123!"
} as const;

type Account = { username: string; password: string };

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

async function login(page: Page, account: Account) {
  await page.goto("/");
  await page.getByPlaceholder("用户名").fill(account.username);
  await page.getByPlaceholder("密码").fill(account.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
  await waitForChatSocket(page);
}

async function openSermonWorkspaceOnce(page: Page) {
  await page.getByRole("button", { name: "更多功能" }).click();
  const tile = page.getByRole("button", { name: "讲道台", exact: true });
  await expect(tile).toBeVisible();
  await tile.click();
  const entry = page.getByRole("dialog", { name: "选择讲道台" });
  const workspace = page.locator(".sermon-workspace.open");
  await Promise.race([
    workspace.waitFor({ state: "visible" }),
    entry.waitFor({ state: "visible" })
  ]);
  if (await entry.isVisible()) await entry.getByRole("button", { name: /进入自己的讲道台/ }).click();
  await expect(workspace).toBeVisible();
  return workspace;
}

async function openSermonWorkspace(page: Page) {
  return openSermonWorkspaceOnce(page);
}

async function closeSermonWorkspace(page: Page, workspace: Locator) {
  await workspace.getByRole("button", { name: "聊天" }).click();
  await expect(page.locator(".sermon-workspace.open")).toHaveCount(0);
}

async function adminToken(request: APIRequestContext) {
  const response = await request.post("/api/auth/login", {
    data: { username: E2E_ADMIN.username, password: E2E_ADMIN.password, deviceName: "sermon-e2e-setup" }
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { token: string };
  return body.token;
}

async function createAccount(
  request: APIRequestContext,
  token: string,
  account: Account & { displayName: string; isAdmin?: boolean }
) {
  const created = await request.post("/api/admin/accounts", {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      username: account.username,
      displayName: account.displayName,
      password: account.password,
      ...(account.isAdmin ? { isAdmin: true } : {})
    }
  });
  expect(created.ok()).toBe(true);
}

async function deleteAccount(request: APIRequestContext, token: string, username: string) {
  const headers = { Authorization: `Bearer ${token}` };
  const list = await request.get("/api/admin/accounts", { headers });
  const body = (await list.json()) as { accounts: Array<{ id: number; username: string }> };
  const account = body.accounts.find((entry) => entry.username === username);
  if (account) {
    await request.delete(`/api/admin/accounts/${account.id}`, { headers });
  }
}

// —— 二期流程 helpers ——

/** 开始屏 → 勾选受邀观众（可选）→ 进入自己的讲道台，进入队列屏。 */
async function startGroupPresentation(workspace: Locator, inviteDisplayName?: string) {
  await expect(workspace.locator(".sermon-start-view")).toBeVisible();
  await expect(workspace.getByRole("radio", { name: /小组演示/ })).toBeChecked();
  if (inviteDisplayName) {
    const row = workspace.locator(".sermon-audience-row", { hasText: inviteDisplayName });
    await expect(row).toBeVisible();
    await row.locator('input[type="checkbox"]').check();
  }
  const enterOwnButton = workspace.getByRole("button", { name: "进入自己的讲道台", exact: true });
  await expect(enterOwnButton).toBeEnabled();
  await enterOwnButton.click();
  await expect(workspace.locator(".sermon-queue-view")).toBeVisible();
}

/** 队列添加内容并点击最后一条进入演示视图。 */
async function addToQueueAndPresent(workspace: Locator, input: string, options?: { onePerSlide?: boolean }) {
  await workspace.locator(".sermon-reference-input").fill(input);
  if (options?.onePerSlide) await workspace.getByRole("checkbox", { name: "每处经文一屏" }).check();
  const addButton = workspace.getByRole("button", { name: "加入队列", exact: true });
  await expect(addButton).toBeEnabled();
  await addButton.click();
  const item = workspace.locator(".sermon-queue-item").last();
  await expect(item).toBeVisible();
  await item.locator(".sermon-queue-main").click();
  const presentView = workspace.locator(".sermon-present-view");
  await expect(presentView).toBeVisible();
  return presentView;
}

/** 观众端：正在讲道预览点「点击进入观看」，通知随后消失并进入全屏。 */
async function joinFromLiveNotification(page: Page, presenterDisplayName: string) {
  const notice = page.locator(".sermon-live-card", { hasText: `${presenterDisplayName} 正在讲道` });
  await expect(notice).toBeVisible();
  await notice.getByRole("button", { name: "点击进入观看", exact: true }).click();
  await expect(notice).toHaveCount(0);
}

/** 演示中工作区「邀请更多观众」→ 勾选 → 发出邀请。 */
async function inviteMoreViewers(workspace: Locator, displayName: string) {
  const more = workspace.locator("details.sermon-invite-more");
  await more.locator("summary").click();
  const row = more.locator(".sermon-audience-row", { hasText: displayName });
  await expect(row).toBeVisible();
  await row.locator('input[type="checkbox"]').check();
  await more.getByRole("button", { name: "发出邀请", exact: true }).click();
}

/** 经页面内 Pinia store 的 socket 直接发事件（仅用于测试 finally 清理演示/释席）。 */
async function emitSermonEvent(page: Page, event: string, payload: unknown) {
  return page.evaluate(
    ({ event, payload }) =>
      new Promise((resolve) => {
        const root = document.querySelector("#app") as HTMLElement & {
          __vue_app__?: { _context?: { provides?: Record<PropertyKey, unknown> } };
        };
        const provides = root?.__vue_app__?._context?.provides;
        const pinia = Reflect.ownKeys(provides || {})
          .map((key) => provides?.[key])
          .find((value) => value && typeof value === "object" && "_s" in value) as
          | { _s?: Map<string, Record<string, unknown>> }
          | undefined;
        const store = [...(pinia?._s?.values() || [])].find(
          (candidate) => "connectionState" in candidate && "socket" in candidate
        );
        const socket = store?.socket as
          | {
              connected?: boolean;
              timeout(ms: number): { emit(e: string, p: unknown, ack: (err: unknown, ack: unknown) => void): void };
            }
          | undefined;
        if (!socket?.connected) {
          resolve({ skipped: "disconnected" });
          return;
        }
        socket.timeout(5000).emit(event, payload, (_error: unknown, ack: unknown) => resolve(ack ?? { ok: true }));
      }),
    { event, payload }
  );
}

async function cleanupPresentations(pages: Page[]) {
  for (const page of pages) {
    await emitSermonEvent(page, "sermon:end", {}).catch(() => undefined);
  }
}

test.beforeAll(async ({ request }) => {
  const token = await adminToken(request);
  await createAccount(request, token, E2E_MEMBER);
  await createAccount(request, token, { ...E2E_ADMIN2, isAdmin: true });
  await createAccount(request, token, E2E_MEMBER2);
});

test.afterAll(async ({ request }) => {
  const token = await adminToken(request);
  await deleteAccount(request, token, E2E_MEMBER.username);
  await deleteAccount(request, token, E2E_ADMIN2.username);
  await deleteAccount(request, token, E2E_MEMBER2.username);
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
    await expect(admin.getByRole("dialog", { name: "选择讲道台" })).toHaveCount(0);
    await expect(admin.locator(".chat-pane")).toHaveCount(0);

    // 管理员开始小组演示并勾选成员；实际展示后，成员从置顶预览进入。
    await startGroupPresentation(workspace, E2E_MEMBER.displayName);
    await expect(workspace.locator(".sermon-scope-status")).toHaveText("当前：小组演示");
    const inviteMore = workspace.locator("details.sermon-invite-more");
    await inviteMore.locator("summary").click();
    const selectAll = inviteMore.getByRole("checkbox", { name: /全选/ });
    await selectAll.check();
    await expect
      .poll(() =>
        inviteMore
          .locator(".sermon-audience-row:not(.sermon-audience-select-all) input[type='checkbox']")
          .evaluateAll((inputs) => inputs.length > 0 && inputs.every((input) => (input as HTMLInputElement).checked))
      )
      .toBe(true);
    await selectAll.uncheck();

    // 空队列也可保存为一条独立方案，保存后立即显示“已保存”状态。
    await workspace.getByPlaceholder("例如：8月30日分享").fill("空白方案");
    await workspace.getByRole("button", { name: "保存当前队列", exact: true }).click();
    await expect(workspace.locator(".sermon-plan-status.saved")).toContainText("当前队列已保存为“空白方案”");
    await expect(workspace.locator(".sermon-plan-row", { hasText: "空白方案" })).toContainText("0 屏");

    await workspace.locator(".sermon-reference-input").fill("约3:16；诗篇23:1");
    // 统一输入框默认整段一屏；勾选「每处经文一屏」让两处出处各自独立成屏。
    await expect(workspace.getByText("自动把内容中的经文分割到队列，每处经文作为一页幻灯片展示。")).toBeVisible();
    await workspace.getByRole("checkbox", { name: "每处经文一屏" }).check();
    const addButton = workspace.getByRole("button", { name: "加入队列", exact: true });
    await expect(addButton).toBeEnabled();
    await addButton.click();
    await expect(workspace.locator(".sermon-queue-item")).toHaveCount(2);
    await workspace.getByPlaceholder("例如：8月30日分享").fill("8月30日分享");
    await workspace.getByRole("button", { name: "保存当前队列", exact: true }).click();
    const savedPlan = workspace.locator(".sermon-plan-row", { hasText: "8月30日分享" });
    await expect(savedPlan).toContainText("2 屏");
    await admin.screenshot({ path: "output/e2e/sermon/presenter-queue.png" });

    // 队列屏点击条目：进入演示视图并推送给观众。
    const firstItem = workspace.locator(".sermon-queue-item").filter({ hasText: "约翰福音 3:16" });
    await firstItem.locator(".sermon-queue-main").click();
    const presentView = workspace.locator(".sermon-present-view");
    await expect(presentView).toBeVisible();
    const liveCard = viewer.locator(".sermon-live-card", { hasText: `${E2E_ADMIN.displayName} 正在讲道` });
    await expect(liveCard).toContainText("神爱世人");
    await viewer.screenshot({ path: "output/e2e/sermon/live-preview-390.png" });
    await joinFromLiveNotification(viewer, E2E_ADMIN.displayName);

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
    // 桌面版心按完整舞台宽度计算；旧的 880px 卡片上限会让此比例只有约 70%。
    await expect
      .poll(() =>
        overlay.evaluate((el) => {
          const card = el.querySelector<HTMLElement>(".sermon-overlay-card");
          const style = getComputedStyle(el);
          const contentWidth = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
          return card ? card.getBoundingClientRect().width / contentWidth : 0;
        })
      )
      .toBeGreaterThan(0.98);
    await viewer.screenshot({ path: "output/e2e/sermon/overlay-1280.png" });
    await viewer.setViewportSize({ width: 390, height: 844 });

    // 控制栏“下一条”切换 sermon:present，观众端同步切换。
    await presentView.getByRole("button", { name: "下一条", exact: true }).click();
    await expect(overlay.locator(".sermon-overlay-badge")).toHaveText(/诗篇\s*23:1/);
    await expect(overlay).toContainText("耶和华是我的牧者");

    // 观众最小化为可拖动悬浮按钮；换屏不会违背用户选择自动展开。
    await viewer.getByRole("button", { name: "最小化讲道经文" }).click();
    const floatingButton = viewer.locator(".sermon-floating-button");
    await expect(floatingButton).toBeVisible();
    await expect(overlay).toHaveCount(0);
    const beforeDrag = await floatingButton.boundingBox();
    expect(beforeDrag).not.toBeNull();
    await floatingButton.dragTo(viewer.locator("body"), { targetPosition: { x: 42, y: 180 } });
    const afterDrag = await floatingButton.boundingBox();
    expect(afterDrag).not.toBeNull();
    expect(Math.abs((afterDrag?.x || 0) - (beforeDrag?.x || 0))).toBeGreaterThan(20);
    await presentView.getByRole("button", { name: "上一条", exact: true }).click();
    await expect(overlay).toHaveCount(0);
    await expect(floatingButton).toContainText(/约翰福音\s*3:16/);
    await floatingButton.click();
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
    const midnightTheme = presentView.getByRole("button", { name: /纯黑$/ });
    await midnightTheme.scrollIntoViewIfNeeded();
    await midnightTheme.click();
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
    const projectorPreview = workspace.locator(".projector-preview .sermon-preview-stage.projector");
    const phonePreview = workspace.locator(".sermon-preview-stage.phone");
    const nextPreview = workspace.locator(".sermon-next-preview .sermon-preview-stage.projector");
    await expect(projectorPreview).toBeVisible();
    await expect(phonePreview).toBeVisible();
    await expect(projectorPreview).toContainText("神爱世人");
    await expect(phonePreview).toContainText("神爱世人");
    await expect(nextPreview).toContainText("耶和华是我的牧者");
    await expect(projectorPreview).toHaveAttribute("data-sermon-font", "songti");
    await expect(projectorPreview).toHaveAttribute("data-sermon-bg", "midnight");
    await expect(phonePreview).toHaveAttribute("data-sermon-font", "songti");
    await expect(workspace.locator(".projector-preview .sermon-preview-frame.projector")).toHaveCSS("background-color", "rgb(0, 0, 0)");
    await expect(workspace.locator(".sermon-preview-frame.phone")).toHaveCSS("background-color", "rgb(0, 0, 0)");
    const chatBox = await workspace.getByRole("button", { name: "聊天", exact: true }).boundingBox();
    const titleBox = await workspace.locator(".sermon-workspace-title").boundingBox();
    expect(chatBox && titleBox && chatBox.x < titleBox.x).toBeTruthy();

    // 桌面队列页用可见投影预览计算可滚动行数；键盘与悬停滚轮都同步当前屏。
    await workspace.locator(".sermon-reference-input").fill("马太3:3-10");
    await workspace.getByRole("button", { name: "加入队列", exact: true }).click();
    const longItem = workspace.locator(".sermon-queue-item").filter({ hasText: "马太福音 3:3-10" });
    await longItem.locator(".sermon-queue-main").click();
    const projectorBody = projectorPreview.locator(".sermon-overlay-body");
    await expect.poll(() => projectorBody.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    const initialScroll = await projectorBody.evaluate((el) => el.scrollTop);
    await admin.keyboard.press("Shift+ArrowDown");
    await expect.poll(() => projectorBody.evaluate((el) => el.scrollTop)).toBeGreaterThan(initialScroll);
    const keyboardScroll = await projectorBody.evaluate((el) => el.scrollTop);
    await workspace.locator(".projector-preview .sermon-preview-frame.projector").hover();
    await admin.mouse.wheel(0, 120);
    await expect.poll(() => projectorBody.evaluate((el) => el.scrollTop)).toBeGreaterThan(keyboardScroll);
    await expect(workspace.locator(".projector-preview .sermon-preview-frame.projector")).toHaveCSS("overflow", "hidden");
    await admin.screenshot({ path: "output/e2e/sermon/presenter-desktop-1440.png" });
    await admin.setViewportSize({ width: 390, height: 844 });
    await expect(presentView).toBeVisible();

    // 自由文字条目：统一输入框不解析经文，整段文字原样入屏并推送给观众。
    await presentView.getByRole("button", { name: "返回演示队列", exact: true }).click();
    await workspace.locator(".sermon-reference-input").fill("证道大纲\n一、神的爱\n\n二、人的回应");
    const textAddButton = workspace.getByRole("button", { name: "加入队列", exact: true });
    await expect(textAddButton).toBeEnabled();
    await textAddButton.click();
    await expect(workspace.locator(".sermon-queue-item")).toHaveCount(4);
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

    // 结束演示（sermon:end）后观众端覆盖层消失并收到结束通知，讲道者回到开始屏。
    admin.once("dialog", (dialog) => dialog.accept());
    await presentView.getByRole("button", { name: "结束展示", exact: true }).click();
    await expect(overlay).toHaveCount(0);
    await expect(viewer.locator(".sermon-floating-button")).toHaveCount(0);
    await expect(viewer.locator(".sermon-hub-toast")).toContainText("演示已结束");
    await expect(workspace.locator(".sermon-start-view")).toBeVisible();
  } finally {
    await cleanupPresentations([admin]);
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

    const adminCard = admin.locator(".sermon-request-card", { hasText: E2E_MEMBER.displayName });
    await expect(adminCard).toBeVisible();
    await expect(adminCard).toContainText("待审批");
    await adminCard.screenshot({ path: "output/e2e/sermon/request-card.png" });

    await adminCard.getByRole("button", { name: "批准", exact: true }).click();
    await adminCard.getByRole("button", { name: "7 天", exact: true }).click();
    await expect(adminCard).toContainText("已批准");
    await expect(memberCard).toContainText("已批准");

    // 申请人收到获批提示，之后“更多”抽屉出现讲道台入口（二期起入口全员可见）。
    await expect(member.locator(".sermon-decision-toast")).toContainText("已批准");
    await member.getByRole("button", { name: "更多功能" }).click();
    await expect(member.getByRole("button", { name: "讲道台", exact: true })).toBeVisible();
  } finally {
    await adminContext.close();
    await memberContext.close();
  }
});

test("小组通知流：预览加入、全屏同步与刷新释席", async ({ browser }) => {
  test.setTimeout(120_000);
  const adminContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const memberContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const admin = await adminContext.newPage();
  const member = await memberContext.newPage();
  await blockPublicNetwork(admin);
  await blockPublicNetwork(member);

  try {
    await login(admin, E2E_ADMIN);
    await login(member, E2E_MEMBER);

    // 主持人开始小组演示并展示经文 → 成员端弹出带内容的置顶预览。
    const workspace = await openSermonWorkspace(admin);
    await startGroupPresentation(workspace, E2E_MEMBER.displayName);
    await addToQueueAndPresent(workspace, "约3:16");
    const liveCard = member.locator(".sermon-live-card", { hasText: `${E2E_ADMIN.displayName} 正在讲道` });
    await expect(liveCard).toContainText("神爱世人");
    await member.screenshot({ path: "output/e2e/sermon/live-notification.png" });
    await joinFromLiveNotification(member, E2E_ADMIN.displayName);

    // 成员点击进入后，全屏覆盖层同步。
    const overlay = member.locator(".sermon-overlay");
    await expect(overlay).toBeVisible();
    await expect(overlay.locator(".sermon-overlay-badge")).toHaveText(/约翰福音\s*3:16/);

    // 成员刷新页面：观众关系易失，覆盖层不再自动出现，主持人端观众名单清空。
    await member.reload();
    await expect(member.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
    await waitForChatSocket(member);
    await expect(overlay).toHaveCount(0);
    await member.waitForTimeout(2000);
    await expect(overlay).toHaveCount(0);
    await expect(workspace.locator(".sermon-viewer-row")).toHaveCount(0);

    // 原观看许可仍有效，成员可从重新出现的预览再次加入。
    await joinFromLiveNotification(member, E2E_ADMIN.displayName);
    await expect(overlay).toBeVisible();
    await expect(overlay.locator(".sermon-overlay-badge")).toHaveText(/约翰福音\s*3:16/);
    await member.screenshot({ path: "output/e2e/sermon/overlay-rejoined.png" });
  } finally {
    await cleanupPresentations([admin]);
    await adminContext.close();
    await memberContext.close();
  }
});

test("观众互斥：两场预览并存并可换席", async ({ browser }) => {
  test.setTimeout(120_000);
  const adminContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const admin2Context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const memberContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const admin = await adminContext.newPage();
  const admin2 = await admin2Context.newPage();
  const member = await memberContext.newPage();
  await blockPublicNetwork(admin);
  await blockPublicNetwork(admin2);
  await blockPublicNetwork(member);

  try {
    await login(admin, E2E_ADMIN);
    await login(admin2, E2E_ADMIN2);
    await login(member, E2E_MEMBER);

    // 两位讲道者各自开始小组演示并都邀请成员；互不可见对方队列。
    const workspaceA = await openSermonWorkspace(admin);
    await startGroupPresentation(workspaceA, E2E_MEMBER.displayName);
    const workspaceB = await openSermonWorkspace(admin2);
    await startGroupPresentation(workspaceB, E2E_MEMBER.displayName);
    await expect(workspaceA.locator(".sermon-queue-item")).toHaveCount(0);
    await expect(workspaceB.locator(".sermon-queue-item")).toHaveCount(0);

    // A 展示诗篇 23:1，成员端出现第一条预览；讲道台入口明确区分本人和 A 的只读讲道台。
    await addToQueueAndPresent(workspaceA, "诗篇23:1");
    await member.getByRole("button", { name: "更多功能" }).click();
    await member.getByRole("button", { name: "讲道台", exact: true }).click();
    const entryDialog = member.getByRole("dialog", { name: "选择讲道台" });
    await expect(entryDialog.getByRole("button", { name: /进入自己的讲道台/ })).toBeVisible();
    const otherWorkspace = entryDialog.getByRole("button", { name: new RegExp(`进入 ${E2E_ADMIN.displayName} 的讲道台`) });
    await expect(otherWorkspace).toContainText("只能观看");
    await entryDialog.getByRole("button", { name: "关闭", exact: true }).click();
    await joinFromLiveNotification(member, E2E_ADMIN.displayName);
    const overlay = member.locator(".sermon-overlay");
    await expect(overlay.locator(".sermon-overlay-badge")).toHaveText(/诗篇\s*23:1/);

    // B 先准备内容：创世 1:1 + 马太 6:9（每处一屏），展示创世 1:1。
    await workspaceB.locator(".sermon-reference-input").fill("创世1:1；马太6:9");
    await workspaceB.getByRole("checkbox", { name: "每处经文一屏" }).check();
    const addButtonB = workspaceB.getByRole("button", { name: "加入队列", exact: true });
    await expect(addButtonB).toBeEnabled();
    await addButtonB.click();
    const genesisItem = workspaceB.locator(".sermon-queue-item").filter({ hasText: "创世记 1:1" });
    await genesisItem.locator(".sermon-queue-main").click();
    await expect(workspaceB.locator(".sermon-present-view")).toBeVisible();
    const noticeB = member.locator(".sermon-live-card", { hasText: `${E2E_ADMIN2.displayName} 正在讲道` });
    await expect(noticeB).toContainText("起初神创造天地");

    // 成员从 B 的预览换席：客户端先离开 A，服务端再许可加入 B。
    await noticeB.getByRole("button", { name: "点击进入观看", exact: true }).click();
    await expect(overlay).toBeVisible();
    await expect(overlay.locator(".sermon-overlay-badge")).toHaveText(/创世记\s*1:1/);

    // A 切到约翰福音 3:16：成员端画面应保持 B 的创世 1:1（A 的推送不再应用）。
    await workspaceA.getByRole("button", { name: "返回演示队列", exact: true }).click();
    await addToQueueAndPresent(workspaceA, "约3:16");
    await member.waitForTimeout(1500);
    await expect(overlay.locator(".sermon-overlay-badge")).toHaveText(/创世记\s*1:1/);

    // B 点「下一条」→ 成员端同步马太福音 6:9。
    await workspaceB.getByRole("button", { name: "下一条", exact: true }).click();
    await expect(overlay.locator(".sermon-overlay-badge")).toHaveText(/马太福音\s*6:9/);
    await member.screenshot({ path: "output/e2e/sermon/overlay-switched.png" });
  } finally {
    await cleanupPresentations([admin, admin2]);
    await adminContext.close();
    await admin2Context.close();
    await memberContext.close();
  }
});

test("主持人移除观众与结束演示通知", async ({ browser }) => {
  test.setTimeout(120_000);
  const adminContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const memberContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const admin = await adminContext.newPage();
  const member = await memberContext.newPage();
  await blockPublicNetwork(admin);
  await blockPublicNetwork(member);

  try {
    await login(admin, E2E_ADMIN);
    await login(member, E2E_MEMBER);

    const workspace = await openSermonWorkspace(admin);
    await startGroupPresentation(workspace, E2E_MEMBER.displayName);
    await addToQueueAndPresent(workspace, "约3:16");
    await joinFromLiveNotification(member, E2E_ADMIN.displayName);
    const overlay = member.locator(".sermon-overlay");
    await expect(overlay).toBeVisible();

    // 观众管理区移除成员：成员端收到轻提示且覆盖层关闭。
    const viewerRow = workspace.locator(".sermon-viewer-row", { hasText: E2E_MEMBER.displayName });
    await expect(viewerRow).toBeVisible();
    await viewerRow.getByRole("button", { name: "移除", exact: true }).click();
    await expect(member.locator(".sermon-hub-toast")).toContainText("移出演示");
    await expect(overlay).toHaveCount(0);
    await member.screenshot({ path: "output/e2e/sermon/removed-toast.png" });

    // 主持人重新邀请，成员再次加入（演示仍激活，覆盖层立即恢复）。
    await inviteMoreViewers(workspace, E2E_MEMBER.displayName);
    await joinFromLiveNotification(member, E2E_ADMIN.displayName);
    await expect(overlay).toBeVisible();

    // 结束演示：观众覆盖层关闭并收到结束通知，主持人回到开始屏。
    admin.once("dialog", (dialog) => dialog.accept());
    await workspace.getByRole("button", { name: "结束展示", exact: true }).click();
    await expect(overlay).toHaveCount(0);
    await expect(member.locator(".sermon-hub-toast")).toContainText("演示已结束");
    await expect(workspace.locator(".sermon-start-view")).toBeVisible();
  } finally {
    await cleanupPresentations([admin]);
    await adminContext.close();
    await memberContext.close();
  }
});

test("集会授权：申请获批后可发起集会演示，全员可加入", async ({ browser }) => {
  test.setTimeout(120_000);
  const adminContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const member2Context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const admin2Context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const admin = await adminContext.newPage();
  const member2 = await member2Context.newPage();
  const admin2 = await admin2Context.newPage();
  await blockPublicNetwork(admin);
  await blockPublicNetwork(member2);
  await blockPublicNetwork(admin2);

  try {
    await login(admin, E2E_ADMIN);
    await login(member2, E2E_MEMBER2);
    await login(admin2, E2E_ADMIN2);

    // 无授权成员：开始屏集会选项禁用，仅可发起小组演示。
    const workspace = await openSermonWorkspace(member2);
    const assemblyRadio = workspace.getByRole("radio", { name: /全体演示/ });
    await expect(assemblyRadio).toBeDisabled();

    // 申请演讲 → 管理员批准 → 集会选项可用。
    await closeSermonWorkspace(member2, workspace);
    await member2.locator(".composer-main textarea").fill("/申请演讲 想主持集会演示");
    await member2.getByRole("button", { name: "发送", exact: true }).click();
    const adminCard = admin.locator(".sermon-request-card", { hasText: E2E_MEMBER2.displayName });
    await expect(adminCard).toBeVisible();
    await adminCard.getByRole("button", { name: "批准", exact: true }).click();
    await adminCard.getByRole("button", { name: "7 天", exact: true }).click();
    await expect(member2.locator(".sermon-decision-toast")).toContainText("已批准");

    // 重新打开工作区刷新授权状态，选择集会并开始演示。
    const reopened = await openSermonWorkspace(member2);
    await expect(assemblyRadio).toBeEnabled();
    await assemblyRadio.check();
    await expect(reopened.getByText("邀请观众（可选）", { exact: true })).toHaveCount(0);
    await expect(reopened.getByRole("button", { name: "进入自己的讲道台", exact: true })).toBeEnabled();
    await reopened.getByRole("button", { name: "进入自己的讲道台", exact: true }).click();
    await expect(reopened.locator(".sermon-queue-view")).toBeVisible();
    await expect(reopened.locator(".sermon-scope-status")).toHaveText("当前：全员集会");
    await expect(reopened.getByText("当前为全员集会，所有成员都可直接观看，无需逐个邀请。")).toBeVisible();

    // 集会演示开始展示后，未受邀的其他账号可直接从置顶预览进入。
    await addToQueueAndPresent(reopened, "约3:16");
    const liveCard = admin2.locator(".sermon-live-card", { hasText: `${E2E_MEMBER2.displayName} 正在讲道` });
    await expect(liveCard).toContainText("全体演示");
    await expect(liveCard).toContainText("神爱世人");
    await liveCard.getByRole("button", { name: "点击进入观看", exact: true }).click();
    const overlay = admin2.locator(".sermon-overlay");
    await expect(overlay).toBeVisible();
    await expect(overlay.locator(".sermon-overlay-badge")).toHaveText(/约翰福音\s*3:16/);
    await expect(overlay).toContainText("神爱世人");
    await admin2.screenshot({ path: "output/e2e/sermon/assembly-overlay.png" });

    // 清理：主持人结束集会演示。
    member2.once("dialog", (dialog) => dialog.accept());
    await reopened.getByRole("button", { name: "结束展示", exact: true }).click();
    await expect(overlay).toHaveCount(0);
    await expect(admin2.locator(".sermon-hub-toast")).toContainText("演示已结束");
  } finally {
    await cleanupPresentations([member2]);
    await adminContext.close();
    await member2Context.close();
    await admin2Context.close();
  }
});
