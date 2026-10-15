import { expect, test } from "@playwright/test";
import { E2E_ADMIN, E2E_MEMBER } from "../seed-data.js";
import { DEFAULT_AI_CONVERSATION } from "../../src/shared/aiConversation.js";
test.use({ actionTimeout: 10000 });
async function showChat(page: import("@playwright/test").Page) {
  const closeBible = page.getByRole("button", {name:"关闭圣经",exact:true});
  if (await closeBible.isVisible()) await closeBible.click();
}

test("分级角色设置、频道邀请和 AI 限额持久化", async ({page,request})=>{
  test.setTimeout(120000);
  const errors: string[]=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.route("**/*",route=>["localhost","127.0.0.1"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto("/");
  await page.getByPlaceholder("用户名").fill(E2E_ADMIN.username);
  await page.getByPlaceholder("密码").fill(E2E_ADMIN.password);
  await page.getByRole("button",{name:"登录",exact:true}).click();
  await expect(page.getByTestId("active-channel-name")).toBeVisible();
  const token=await page.evaluate(()=>localStorage.getItem("team-chat-token"));
  const headers={Authorization:`Bearer ${token}`};
  await page.goto("/ai-settings");
  for(const name of ["DeepSeek","阿里百炼","小米 MiMo","火山引擎 · Seed Character"]) await expect(page.locator("summary").filter({hasText:name})).toBeVisible();
  await page.getByRole("button",{name:/虚拟角色.*人设/}).click();
  await page.getByRole("button",{name:"新增角色",exact:true}).click();
  await page.getByLabel("ID",{exact:true}).fill("ai_e2e_observer");
  await page.getByLabel("昵称",{exact:true}).fill("自主对话观察角色");
  await page.getByLabel("人设",{exact:true}).fill("喜欢提出不同观点，自然参与讨论。");
  await page.getByRole("button",{name:"记忆",exact:true}).click();
  await page.getByLabel("长期记忆",{exact:true}).fill("请记住我的初始设定。");
  await page.getByRole("button",{name:"模型",exact:true}).click();
  await page.getByLabel("平台",{exact:true}).selectOption("volcengine");
  await page.getByLabel("模型 ID",{exact:true}).fill("doubao-seed-character-251128");
  await page.getByRole("button",{name:"创建角色",exact:true}).click();
  await expect(page.locator(".ai-role-choice").filter({hasText:"自主对话观察角色"})).toBeVisible();
  await page.locator(".ai-role-choice").filter({hasText:"自主对话观察角色"}).click();
  for(const width of [360,390,1365]) {
    await page.setViewportSize({width,height:900});
    await expect(page.getByLabel("昵称",{exact:true})).toBeVisible();
    expect(await page.locator(".ai-settings-form").evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);
    await page.screenshot({path:`output/e2e/ai-settings-${width}.png`});
  }
  const rows=(await (await request.get("/api/virtual-characters",{headers})).json()).characters as Array<{id:number;actor:{username:string};config:{generation:{provider:string};manualMemory:{longTerm:string}}}>;
  const created=rows.find(row=>row.actor.username==="ai_e2e_observer")!;
  expect(created.config.generation.provider).toBe("volcengine");
  expect(created.config.manualMemory.longTerm).toBe("请记住我的初始设定。");
  const second=(await (await request.post("/api/virtual-characters",{headers,data:{username:"ai_e2e_partner",displayName:"对话伙伴",enabled:true}})).json()).character;
  const channelResponse=await request.post("/api/channels",{headers,data:{name:"AI 自主对话验收",isPrivate:true}});
  expect(channelResponse.status()).toBe(200);
  const channel=(await channelResponse.json()).channel;
  const before=(await (await request.get(`/api/channels/${channel.id}/members`,{headers})).json()).members;
  expect(before.filter((row:{kind:string})=>row.kind==="virtual")).toHaveLength(0);
  const invited=await request.post(`/api/channels/${channel.id}/members`,{headers,data:{virtualCharacterIds:[created.id,second.id]}});
  expect(invited.status()).toBe(200);
  await page.getByRole("button",{name:"回到聊天",exact:true}).click();
  await showChat(page);
  const expandChannels = page.getByRole("button", {name:"展开频道",exact:true});
  if (await expandChannels.isVisible()) await expandChannels.click();
  await page.getByRole("button",{name:/AI 自主对话验收$/}).click();
  await expect(page.getByTestId("active-channel-name")).toHaveText("AI 自主对话验收");
  const collapseChannels = page.getByRole("button", {name:"收起频道",exact:true});
  if (await collapseChannels.isVisible()) await collapseChannels.click();
  const panel=page.locator(".ai-conversation-panel");
  await panel.getByRole("button",{name:/AI 自主对话/}).click();
  await panel.getByLabel("将此频道设为 AI 强参与频道").check();
  await panel.getByLabel("自主对话观察角色",{exact:true}).check();
  await panel.getByLabel("对话伙伴",{exact:true}).check();
  await panel.getByLabel("发言条数上限").fill("8");
  await panel.getByLabel("讨论主题").fill("两位讨论如何开始一个新项目");
  await panel.getByRole("button",{name:"保存频道设置"}).click();
  await expect(panel.getByRole("button",{name:"开始自主对话"})).toBeEnabled();
  await page.reload();
  await showChat(page);
  await expect(panel.getByRole("button",{name:/AI 自主对话/})).toBeVisible();
  await panel.getByRole("button",{name:/AI 自主对话/}).click();
  await expect(panel.getByLabel("发言条数上限")).toHaveValue("8");
  await expect(panel.getByLabel("讨论主题")).toHaveValue("两位讨论如何开始一个新项目");
  for(const width of [360,390,1365]) {
    await page.setViewportSize({width,height:900});
    await expect.poll(async () => {
      await showChat(page);
      const closeChannels=page.getByRole("button",{name:"关闭频道",exact:true});
      if(await closeChannels.isVisible()) await closeChannels.click();
      return panel.isVisible();
    }).toBe(true);
    await expect(panel).toBeVisible();
    expect(await panel.evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);
    await page.screenshot({path:`output/e2e/ai-channel-${width}.png`});
  }
  const memberCreated=await request.post("/api/admin/accounts",{headers,data:E2E_MEMBER});
  expect(memberCreated.status()).toBe(200);
  const memberAccount=(await memberCreated.json()).account;
  expect((await request.post(`/api/channels/${channel.id}/members`,{headers,data:{accountIds:[memberAccount.id]}})).status()).toBe(200);
  const memberLogin=await request.post("/api/auth/login",{data:E2E_MEMBER});
  expect(memberLogin.status()).toBe(200);
  const memberToken=(await memberLogin.json()).token;
  expect((await request.get(`/api/channels/${channel.id}/ai-conversation`,{headers:{Authorization:`Bearer ${memberToken}`}})).status()).toBe(200);
  const denied=await request.post(`/api/channels/${channel.id}/ai-conversation`,{headers:{Authorization:`Bearer ${memberToken}`},data:{action:"start",config:{...DEFAULT_AI_CONVERSATION,enabled:true,characterIds:[created.id,second.id]}}});
  expect(denied.status()).toBe(403);
  expect((await request.delete(`/api/channels/${channel.id}/virtual-members/${created.id}`,{headers})).status()).toBe(200);
  await page.reload();
  await showChat(page);
  await panel.getByRole("button",{name:/AI 自主对话/}).click();
  await panel.getByLabel("将此频道设为 AI 强参与频道").uncheck();
  await panel.getByRole("button",{name:"保存频道设置"}).click();
  await expect.poll(async () => (await (await request.get(`/api/channels/${channel.id}/ai-conversation`,{headers})).json()).config.enabled).toBe(false);
  expect(errors).toEqual([]);
});

test("频道内开始、暂停、继续、终止按钮提交正确控制动作",async ({page})=>{
  const config={...DEFAULT_AI_CONVERSATION,enabled:true,characterIds:[1,2]};
  const status={state:"idle",messages:0,contextChars:0,elapsedSeconds:0,reason:""};
  const actions:string[]=[];
  await page.route("**/api/channels/*/ai-conversation",async route=>{
    if(route.request().method()==="POST") {
      const body=route.request().postDataJSON();actions.push(body.action);
      status.state=body.action==="pause" ? "paused" : body.action==="stop" ? "stopped":"running";
    }
    await route.fulfill({json:{config,status,canControl:true,characters:[{id:1,displayName:"甲"},{id:2,displayName:"乙"}]}});
  });
  await page.goto("/");await page.getByPlaceholder("用户名").fill(E2E_ADMIN.username);await page.getByPlaceholder("密码").fill(E2E_ADMIN.password);await page.getByRole("button",{name:"登录",exact:true}).click();
  const panel=page.locator(".ai-conversation-panel");
  await panel.getByRole("button",{name:/AI 自主对话/}).click();
  await panel.getByRole("button",{name:"开始自主对话"}).click();
  await panel.getByRole("button",{name:"暂停",exact:true}).click();
  await panel.getByRole("button",{name:"继续",exact:true}).click();
  await panel.getByRole("button",{name:"终止",exact:true}).click();
  await expect(panel.getByRole("button",{name:/AI 自主对话 · 已终止/})).toBeVisible();
  expect(actions).toEqual(["start","pause","resume","stop"]);
});
