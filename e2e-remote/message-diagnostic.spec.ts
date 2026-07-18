import crypto from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { readChatConnection, waitForChatSocket } from "./chat-state.js";
import { isApprovedRemoteRequest, remoteE2EEnvironment } from "./safety.js";

const remote = remoteE2EEnvironment();

type AckSummary = { received: boolean; success: boolean | null; messageIdPresent: boolean; errorKind: string | null };

function diagnosticMarker() {
  const supplied = process.env.REMOTE_E2E_DIAG_MARKER;
  if (supplied) return supplied;
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  return `[REMOTE-E2E-DIAG-${timestamp}-${crypto.randomBytes(3).toString("hex")}]`;
}

function classifyAckError(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  if (/认证/.test(value)) return "authentication";
  if (/无权|权限/.test(value)) return "authorization";
  if (/为空/.test(value)) return "empty-content";
  if (/foreign key|constraint/i.test(value)) return "database-constraint";
  if (/prisma/i.test(value)) return "prisma";
  return "server-rejected";
}

async function installSocketDiagnostics(page: Page, marker: string) {
  const state = {
    emitted: false,
    eventName: null as string | null,
    ackId: null as string | null,
    channelIdIsNumber: false,
    contentMatchesMarker: false,
    type: null as string | null,
    replyToIdPresent: false,
    ack: { received: false, success: null, messageIdPresent: false, errorKind: null } as AckSummary
  };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");

  function inspectPayload(raw: string) {
    let decoded = raw;
    try {
      if (/%(?:5B|22|7B)/i.test(raw)) decoded = decodeURIComponent(raw);
    } catch {
      decoded = raw;
    }
    for (const packet of decoded.split("\u001e")) {
      const eventMatch = packet.match(/^42(\d*)(\[.*\])$/s);
      if (eventMatch) {
        try {
          const [eventName, payload] = JSON.parse(eventMatch[2]) as [string, Record<string, unknown>];
          if (eventName !== "message:send") continue;
          state.emitted = true;
          state.eventName = eventName;
          state.ackId = eventMatch[1] || null;
          state.channelIdIsNumber = typeof payload?.channelId === "number";
          state.contentMatchesMarker = payload?.content === marker;
          state.type = typeof payload?.type === "string" ? payload.type : null;
          state.replyToIdPresent = Object.prototype.hasOwnProperty.call(payload || {}, "replyToId");
        } catch {}
        continue;
      }
      const ackMatch = packet.match(/^43(\d+)(\[.*\])$/s);
      if (!ackMatch || !state.ackId || ackMatch[1] !== state.ackId) continue;
      try {
        const [ack] = JSON.parse(ackMatch[2]) as [Record<string, unknown>];
        state.ack = {
          received: true,
          success: typeof ack?.success === "boolean" ? ack.success : null,
          messageIdPresent: typeof ack?.messageId === "number",
          errorKind: ack?.success === false ? classifyAckError(ack.message) : null
        };
      } catch {}
    }
  }

  cdp.on("Network.webSocketFrameSent", ({ response }) => inspectPayload(response.payloadData));
  cdp.on("Network.webSocketFrameReceived", ({ response }) => inspectPayload(response.payloadData));
  cdp.on("Network.requestWillBeSent", ({ request }) => {
    if (request.url.includes("/socket.io/") && request.postData) inspectPayload(request.postData);
  });
  cdp.on("Network.responseReceived", async ({ requestId, response }) => {
    if (!response.url.includes("/socket.io/")) return;
    try {
      const body = await cdp.send("Network.getResponseBody", { requestId });
      inspectPayload(body.body);
    } catch {}
  });
  return state;
}

async function loginToDiagnosticChannel(page: Page) {
  await page.route("**/*", async (route) => {
    if (isApprovedRemoteRequest(route.request().url())) return route.continue();
    return route.abort("blockedbyclient");
  });
  await page.goto("/");
  await page.getByPlaceholder("用户名").fill(remote.username);
  await page.getByPlaceholder("密码").fill(remote.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  const channel = page.getByRole("button", { name: remote.channel, exact: true });
  await expect(channel).toBeVisible();
  await channel.click();
  await expect(page.getByTestId("active-channel-name")).toHaveText(remote.channel);
  await waitForChatSocket(page);
}

test("单条消息发送与刷新持久化诊断", async ({ page }) => {
  const marker = diagnosticMarker();
  const socket = await installSocketDiagnostics(page, marker);
  const dialogs: Array<{ type: string; errorKind: string | null }> = [];
  page.on("dialog", async (dialog) => {
    dialogs.push({ type: dialog.type(), errorKind: classifyAckError(dialog.message()) });
    await dialog.dismiss();
  });

  await loginToDiagnosticChannel(page);
  const input = page.getByPlaceholder("输入消息");
  const send = page.getByRole("button", { name: "发送", exact: true });
  await input.fill(marker);
  const before = {
    urlIsApproved: isApprovedRemoteRequest(page.url()),
    channelMatches: (await page.getByTestId("active-channel-name").textContent())?.trim() === remote.channel,
    inputVisible: await input.isVisible(),
    inputEditable: await input.isEditable(),
    sendEnabled: await send.isEnabled(),
    inputMatchesMarker: (await input.inputValue()) === marker,
    connection: await readChatConnection(page)
  };

  await send.click();
  const realMessage = page.locator(".message-row[data-message-id]").filter({ hasText: marker });
  let explicitOutcomeObserved = true;
  try {
    await expect.poll(() => socket.ack.received || dialogs.length > 0 || realMessage.count().then((count) => count > 0), { timeout: 15_000 }).toBeTruthy();
  } catch {
    explicitOutcomeObserved = false;
  }
  const after = {
    inputCleared: (await input.inputValue()) === "",
    realMessageCount: await realMessage.count(),
    failureDialog: dialogs.length > 0,
    failedOrRetryState: await page.locator('[data-send-state="failed"], [data-send-state="retry"], [data-send-state="pending"]').count(),
    connection: await readChatConnection(page)
  };
  await page.reload();
  await expect(page.getByTestId("active-channel-name")).toHaveText(remote.channel);
  const refreshedMessageCount = await page.locator(".message-row[data-message-id]").filter({ hasText: marker }).count();

  console.log(`REMOTE_E2E_MESSAGE_DIAG ${JSON.stringify({ marker, before, explicitOutcomeObserved, after, socket, refreshedMessageCount })}`);
  expect(before.urlIsApproved).toBe(true);
  expect(before.channelMatches).toBe(true);
  expect(before.inputVisible).toBe(true);
  expect(before.inputEditable).toBe(true);
  expect(before.sendEnabled).toBe(true);
  expect(before.inputMatchesMarker).toBe(true);
  expect(before.connection.socketConnected).toBe(true);
  expect(explicitOutcomeObserved).toBe(true);
  expect(after.inputCleared).toBe(true);
  expect(after.realMessageCount).toBe(1);
  expect(after.failureDialog).toBe(false);
  expect(socket.emitted).toBe(true);
  expect(socket.eventName).toBe("message:send");
  expect(socket.channelIdIsNumber).toBe(true);
  expect(socket.contentMatchesMarker).toBe(true);
  expect(socket.type).toBe("text");
  expect(socket.replyToIdPresent).toBe(true);
  expect(socket.ack).toEqual({ received: true, success: true, messageIdPresent: true, errorKind: null });
  expect(refreshedMessageCount).toBe(1);
});
