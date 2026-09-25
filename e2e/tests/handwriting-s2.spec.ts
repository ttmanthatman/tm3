import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN, E2E_CHANNELS } from "../seed-data.js";

async function login(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("用户名").fill(E2E_ADMIN.username);
  await page.getByPlaceholder("密码").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
  await expect.poll(() => page.evaluate(() => {
    const root = document.querySelector("#app") as HTMLElement & { __vue_app__?: { _context?: { provides?: Record<PropertyKey, unknown> } } };
    const provides = root?.__vue_app__?._context?.provides;
    const pinia = Reflect.ownKeys(provides || {}).map((key) => provides?.[key]).find((value) => value && typeof value === "object" && "_s" in value) as { _s?: Map<string, Record<string, unknown>> } | undefined;
    const store = [...(pinia?._s?.values() || [])].find((candidate) => "connectionState" in candidate && "socket" in candidate);
    return store?.connectionState;
  })).toBe("connected");
}

test("handwriting socket send validates, normalizes and deduplicates the real entry path", async ({ page }) => {
  test.setTimeout(60_000);
  await login(page);
  const result = await page.evaluate(async () => {
    const root = document.querySelector("#app") as HTMLElement & { __vue_app__?: { _context?: { provides?: Record<PropertyKey, unknown> } } };
    const provides = root?.__vue_app__?._context?.provides;
    const pinia = Reflect.ownKeys(provides || {}).map((key) => provides?.[key]).find((value) => value && typeof value === "object" && "_s" in value) as { _s?: Map<string, Record<string, unknown>> } | undefined;
    const store = [...(pinia?._s?.values() || [])].find((candidate) => "connectionState" in candidate && "socket" in candidate);
    const socket = store?.socket as { timeout(ms: number): { emit(event: string, data: unknown, ack: (error: Error | null, response?: Record<string, unknown>) => void): void } } | undefined;
    if (!socket || typeof store?.currentChannelId !== "number") throw new Error("chat socket was not found");
    const requestId = crypto.randomUUID();
    const brush = { size: 45, sensitivity: 65, lag: 35 };
    const payload = { kind: "handwriting", version: 1, characters: [{ strokes: Array.from({ length: 6 }, (_, strokeIndex) => ({
      brush,
      points: Array.from({ length: 10_000 }, (_, index) => [9999, 9999, strokeIndex === 0 && index === 0 ? 0 : 100_000 + strokeIndex * 10_000 + index])
    })) }] };
    if (new TextEncoder().encode(JSON.stringify(payload)).byteLength <= 1_000_000) throw new Error("Expected payload above the old transport limit");
    const emit = (step: string, data: unknown) => new Promise<Record<string, unknown>>((resolve, reject) => {
      socket.timeout(10_000).emit("message:send", data, (error, response) => error ? reject(new Error(`${step}: ${error.message}`)) : resolve(response || {}));
    });
    const base = { channelId: store.currentChannelId, type: "handwriting", content: "伪造标签", payload, clientRequestId: requestId, replyToId: null };
    const first = await emit("first", base);
    const replay = await emit("replay", base);
    const changedBrush = structuredClone(payload);
    changedBrush.characters[0].strokes[0].brush.size = 46;
    const conflict = await emit("conflict", { ...base, payload: changedBrush });
    const invalid = await emit("invalid", { ...base, clientRequestId: crypto.randomUUID(), payload: { ...payload, version: 2 } });
    const status = await new Promise<Record<string, unknown>>((resolve, reject) => {
      socket.timeout(10_000).emit("message:status", { clientRequestId: requestId }, (error, response) => error ? reject(error) : resolve(response || {}));
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const visibleCopies = Array.isArray(store.messages)
      ? (store.messages as Array<{ clientRequestId?: string }>).filter((message) => message.clientRequestId === requestId).length
      : -1;
    return { first, replay, conflict, invalid, status, visibleCopies };
  });

  expect(result.first).toMatchObject({
    success: true,
    deduplicated: false,
    message: {
      content: "[手写消息]",
      type: "handwriting",
      payload: { kind: "handwriting", version: 1, characters: [{ strokes: expect.arrayContaining([expect.objectContaining({ brush: { size: 45, sensitivity: 65, lag: 35 } })]) }] }
    }
  });
  expect(result.replay).toMatchObject({ success: true, messageId: result.first.messageId, deduplicated: true });
  expect(result.conflict).toMatchObject({ success: false, code: "conflict" });
  expect(result.invalid).toMatchObject({ success: false, code: "not_sent" });
  expect(result.status).toMatchObject({ state: "sent", messageId: result.first.messageId });
  expect(result.visibleCopies).toBe(1);
});
