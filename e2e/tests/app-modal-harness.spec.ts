import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { compileScript, compileTemplate, parse } from "@vue/compiler-sfc";
import { transformSync } from "esbuild";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// 直接把磁盘上的真实 AppModal.vue 编译成浏览器可加载的 ES module，
// 用一个最小宿主页验证双层 AppModal 叠放时的 Escape / Tab / 焦点归还行为。
function compileAppModal() {
  const filename = path.join(ROOT, "src/client/components/ui/AppModal.vue");
  const source = fs.readFileSync(filename, "utf8");
  const { descriptor, errors } = parse(source, { filename });
  if (errors.length) throw new Error(`AppModal.vue 解析失败: ${errors.map(String).join("; ")}`);
  if (!descriptor.template) throw new Error("AppModal.vue 缺少模板");
  const script = compileScript(descriptor, { id: "harness" });
  const template = compileTemplate({
    source: descriptor.template.content,
    filename,
    id: "harness",
    compilerOptions: { bindingMetadata: script.bindings }
  });
  const rewrite = (code: string) =>
    code
      .replace(/from ["']vue["']/g, 'from "/harness/vue.js"')
      .replace(/from ["']lucide-vue-next["']/g, 'from "/harness/lucide-stub.js"')
      .replace(/from ["']\.\/modalStack["']/g, 'from "/harness/modalStack.js"');
  const scriptCode = rewrite(script.content);
  if (!scriptCode.includes("export default")) throw new Error("AppModal.vue 编译结果缺少默认导出");
  const scriptWithRender = scriptCode.replace("export default", "const _sfc_main =");
  const combined = `${rewrite(template.code)}\n${scriptWithRender}\n_sfc_main.render = render;\nexport default _sfc_main;\n`;
  // compileScript 不会移除 setup 函数体里的 TS 标注，交给 esbuild 剥离。
  return transformSync(combined, { loader: "ts", format: "esm" }).code;
}

const HARNESS_HTML = `<!doctype html>
<html>
  <body>
    <button id="trigger-a" type="button" onclick="window.harness.openA.value = true">open A</button>
    <div id="app"></div>
    <script type="module">
      import { createApp, h, ref } from "/harness/vue.js";
      import AppModal from "/harness/AppModal.js";
      const app = createApp({
        setup() {
          const openA = ref(false);
          const openB = ref(false);
          const busyB = ref(false);
          window.harness = {
            openA,
            openB,
            busyB,
            closes: { a: 0, b: 0 }
          };
          return () => h("div", null, [
            h(
              AppModal,
              { open: openA.value, title: "Modal A", onClose: () => { window.harness.closes.a += 1; openA.value = false; } },
              () => [h("button", { id: "open-b", type: "button", onClick: () => { openB.value = true; } }, "open B")]
            ),
            h(
              AppModal,
              { open: openB.value, title: "Modal B", busy: busyB.value, onClose: () => { window.harness.closes.b += 1; openB.value = false; } },
              () => [h("button", { id: "b-action", type: "button" }, "B action")]
            )
          ]);
        }
      });
      app.mount("#app");
    </script>
  </body>
</html>`;

const LUCIDE_STUB = `import { h } from "/harness/vue.js";
export const X = { name: "XStub", props: ["size"], setup() { return () => h("span", { class: "x-stub" }); } };
`;

async function serveHarness(page: Page) {
  const vueSource = fs.readFileSync(path.join(ROOT, "node_modules/vue/dist/vue.esm-browser.js"), "utf8");
  const appModalModule = compileAppModal();
  const modalStackModule = transformSync(
    fs.readFileSync(path.join(ROOT, "src/client/components/ui/modalStack.ts"), "utf8"),
    { loader: "ts", format: "esm" }
  ).code;
  await page.route("**/app-modal-harness", (route) =>
    route.fulfill({ contentType: "text/html", body: HARNESS_HTML })
  );
  await page.route("**/harness/vue.js", (route) => route.fulfill({ contentType: "text/javascript", body: vueSource }));
  await page.route("**/harness/AppModal.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: appModalModule })
  );
  await page.route("**/harness/modalStack.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: modalStackModule })
  );
  await page.route("**/harness/lucide-stub.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: LUCIDE_STUB })
  );
  await page.goto("/app-modal-harness");
  await page.locator("#trigger-a").waitFor();
}

const modalA = (page: Page) => page.getByRole("dialog", { name: "Modal A" });
const modalB = (page: Page) => page.getByRole("dialog", { name: "Modal B" });

async function closes(page: Page) {
  return page.evaluate(() => (window as unknown as { harness: { closes: { a: number; b: number } } }).harness.closes);
}

async function expectFocusInside(page: Page, dialogName: "Modal A" | "Modal B") {
  const dialog = page.getByRole("dialog", { name: dialogName });
  await expect.poll(() => dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
}

test("双层 AppModal：一次 Escape 只关闭最上层，焦点逐层归还", async ({ page }) => {
  await serveHarness(page);

  await page.locator("#trigger-a").click();
  await expect(modalA(page)).toBeVisible();
  await expectFocusInside(page, "Modal A");

  await page.locator("#open-b").click();
  await expect(modalB(page)).toBeVisible();
  await expectFocusInside(page, "Modal B");

  await page.keyboard.press("Escape");
  await expect(modalB(page)).toHaveCount(0);
  await expect(modalA(page)).toBeVisible();
  expect(await closes(page)).toEqual({ a: 0, b: 1 });
  await expectFocusInside(page, "Modal A");

  await page.keyboard.press("Escape");
  await expect(modalA(page)).toHaveCount(0);
  expect(await closes(page)).toEqual({ a: 1, b: 1 });
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("trigger-a");
});

test("双层 AppModal：Tab/Shift+Tab 只在最上层弹窗内循环", async ({ page }) => {
  await serveHarness(page);
  await page.locator("#trigger-a").click();
  await page.locator("#open-b").click();
  await expect(modalB(page)).toBeVisible();

  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press("Tab");
    await expectFocusInside(page, "Modal B");
  }
  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press("Shift+Tab");
    await expectFocusInside(page, "Modal B");
  }
});

test("busy 的最上层弹窗不响应 Escape，解除 busy 后可关闭", async ({ page }) => {
  await serveHarness(page);
  await page.locator("#trigger-a").click();
  await page.locator("#open-b").click();
  await expect(modalB(page)).toBeVisible();

  await page.evaluate(() => {
    (window as unknown as { harness: { busyB: { value: boolean } } }).harness.busyB.value = true;
  });
  await page.keyboard.press("Escape");
  await expect(modalB(page)).toBeVisible();
  expect(await closes(page)).toEqual({ a: 0, b: 0 });

  await page.evaluate(() => {
    (window as unknown as { harness: { busyB: { value: boolean } } }).harness.busyB.value = false;
  });
  await page.keyboard.press("Escape");
  await expect(modalB(page)).toHaveCount(0);
  expect(await closes(page)).toEqual({ a: 0, b: 1 });
});

test("反复开关 20 次后行为保持一致", async ({ page }) => {
  await serveHarness(page);
  for (let round = 1; round <= 20; round += 1) {
    await page.locator("#trigger-a").click();
    await expect(modalA(page)).toBeVisible();
    await expectFocusInside(page, "Modal A");
    await page.keyboard.press("Escape");
    await expect(modalA(page)).toHaveCount(0);
    expect((await closes(page)).a).toBe(round);
  }
});
