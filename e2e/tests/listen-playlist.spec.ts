import { expect, test, type Page } from "@playwright/test";
import { focusChat } from "../helpers/chat.js";
import { E2E_ADMIN, E2E_CHANNELS } from "../seed-data.js";

// 「/听」播放清单：composer 斜杠命令 → 服务端解析经文引用 → 聊天里渲染清单卡片（含播放控制）。
// e2e 库没有有声圣经包，点播放会收到「暂未开放」提示；播放编排的状态机由 useListenSession 单测覆盖。

async function loginAsAdmin(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("用户名").fill(E2E_ADMIN.username);
  await page.getByPlaceholder("密码").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
  await focusChat(page);
}

test("/听 draft becomes an ordered listen playlist card with transport controls", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 960 });
  await loginAsAdmin(page);
  const textarea = page.locator(".composer-main textarea");

  // 斜杠菜单里能找到 /听（菜单项显示命令与提示文字）
  await textarea.click();
  await textarea.pressSequentially("/听");
  const suggestion = page.locator(".composer-suggestion").filter({ hasText: "/听" });
  await expect(suggestion).toBeVisible();
  await expect(suggestion).toContainText("@@");
  await textarea.fill("");

  const stamp = Date.now();
  await textarea.fill(`/听 诗篇23 约翰福音3:16 今晚一起听 ${stamp}`);
  await page.getByRole("button", { name: "发送", exact: true }).click();

  const card = page.locator(".listen-card").filter({ hasText: `今晚一起听 ${stamp}` });
  await expect(card).toBeVisible();
  await expect(card.locator(".listen-card-kicker")).toHaveText(/一起听/);
  await expect(card.locator(".listen-card-head small")).toContainText("2 段经文");
  const rows = card.locator(".listen-card-row");
  await expect(rows).toHaveCount(2);
  // 引用按服务端解析结果重写，保持 composer 里的书写顺序
  await expect(rows.nth(0).locator(".listen-card-label")).toHaveText("诗篇 第23章");
  await expect(rows.nth(1).locator(".listen-card-label")).toHaveText("约翰福音 3:16");
  await expect(rows.locator(".listen-card-row.current")).toHaveCount(0);

  const controls = card.locator(".listen-card-controls");
  await expect(controls.getByRole("button", { name: "播放", exact: true })).toBeEnabled();
  await expect(controls.getByRole("button", { name: "上一节", exact: true })).toBeDisabled();
  await expect(controls.getByRole("button", { name: "下一节", exact: true })).toBeDisabled();
  await expect(controls.getByRole("button", { name: "上一章", exact: true })).toBeDisabled();
  await expect(controls.getByRole("button", { name: "下一章", exact: true })).toBeDisabled();

  // 消息正文摘要（通知/引用预览用）也按解析后的引用生成
  await expect(page.locator(".message-row").filter({ has: card })).toBeVisible();

  // 没有有声圣经包：点播放会在聊天侧弹出「暂未开放」提示（工作区里的 toast 关着时看不见），卡片不会假装在播
  const dialogMessage = new Promise<string>((resolve) => page.once("dialog", (dialog) => { resolve(dialog.message()); void dialog.dismiss(); }));
  await controls.getByRole("button", { name: "播放", exact: true }).click();
  expect(await dialogMessage).toContain("有声圣经暂未开放");
  await expect(card).not.toHaveClass(/playing/);
  await expect(card.locator(".listen-card-row.current")).toHaveCount(0);
});

test("an empty /听 draft stays in the composer with a hint", async ({ page }) => {
  await loginAsAdmin(page);
  const textarea = page.locator(".composer-main textarea");
  await textarea.fill("/听 今晚一起听吧");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(textarea).toHaveValue("/听 今晚一起听吧");
  await expect(page.getByText("请写一处经文，或用 @@ 选一首歌")).toBeVisible();
});

test("the listen card paints the playing item orange and bold with its verse line", async ({ page }) => {
  await page.route("**/listen-card-harness", (route) => route.fulfill({ contentType: "text/html", body: '<!doctype html><meta charset="utf-8"><main id="host"></main>' }));
  await page.goto("/listen-card-harness");
  await page.evaluate(async () => {
    const path = "/src/client/features/listen/ListenPlaylistCard.vue";
    const source = await (await fetch(path)).text();
    const vuePath = /from ["']([^"']*\/vue\.js[^"']*)["']/.exec(source)?.[1];
    if (!vuePath) throw new Error("missing Vue runtime");
    const { createApp, h } = await import(vuePath) as typeof import("vue");
    const { default: Card } = await import(path);
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "/src/client/styles.css";
    document.head.append(css);
    await new Promise<void>((resolve, reject) => { css.onload = () => resolve(); css.onerror = () => reject(new Error("styles failed")); });
    const playlist = {
      kind: "listen_playlist",
      translation: "和合本",
      note: "睡前一起听",
      items: [
        { kind: "scripture", reference: "诗篇 23:1-6", bookCode: "PSA", bookName: "诗篇", startChapter: 23, startVerse: 1, endChapter: 23, endVerse: 6 },
        { kind: "track", trackId: 7, title: "奇异恩典" },
        { kind: "scripture", reference: "约翰福音 3:16", bookCode: "JHN", bookName: "约翰福音", startChapter: 3, startVerse: 16, endChapter: 3, endVerse: 16 }
      ]
    };
    const lookup = {
      reference: "诗篇 23:1-6", normalizedReference: "诗篇 23:1-6", translation: "和合本", sourceId: "x",
      verses: [1, 2, 3, 4, 5, 6].map((verse) => ({ book: "诗篇", chapter: 23, verse, endVerse: verse, reference: `诗篇 23:${verse}`, text: `第${verse}节的经文。` }))
    };
    createApp({ render: () => h("div", { class: "message-row", style: "margin:24px" }, [h("div", { class: "bubble" }, [h(Card, {
      playlist,
      session: { messageId: 1, index: 0, phase: "scripture", playing: true, verse: 3, chapter: 23 },
      scope: 1,
      bibleReferenceLookup: () => lookup,
      ensureBibleReferenceLookup: () => undefined,
      openPassage: async () => undefined,
      paperSeed: "a"
    })])]) }).mount(document.getElementById("host")!);
  });
  const card = page.locator(".listen-card");
  await expect(card).toHaveClass(/playing/);
  const current = card.locator(".listen-card-row.current");
  await expect(current).toHaveCount(1);
  await expect(current.locator(".listen-card-label")).toHaveText("诗篇 23:1-6");
  await expect(current.locator(".listen-card-verse")).toHaveText("第 3 节");
  const style = await current.locator(".listen-card-label").evaluate((element) => {
    const computed = getComputedStyle(element);
    return { color: computed.color, weight: computed.fontWeight };
  });
  expect(style.color).toBe("rgb(249, 115, 22)");
  expect(Number(style.weight)).toBeGreaterThanOrEqual(700);
  await expect(card.locator(".listen-card-prompt")).toHaveText("第3节的经文。");
  await expect(card.locator(".listen-card-row").nth(1).locator(".listen-card-label")).toHaveText("奇异恩典");
  const idle = await card.locator(".listen-card-row").nth(1).locator(".listen-card-label").evaluate((element) => getComputedStyle(element).color);
  expect(idle).not.toBe("rgb(249, 115, 22)");
  await expect(card.locator(".listen-card-controls").getByRole("button", { name: "暂停", exact: true })).toBeVisible();
  await expect(card.locator(".listen-card-controls").getByRole("button", { name: "下一节", exact: true })).toBeEnabled();
});
