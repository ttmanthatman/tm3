import { expect, type Page } from "@playwright/test";

export async function readChatConnection(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector("#app") as HTMLElement & { __vue_app__?: { _context?: { provides?: Record<PropertyKey, unknown> } } };
    const provides = root?.__vue_app__?._context?.provides;
    if (!provides) return { storeFound: false, connectionState: null, socketPresent: false, socketConnected: false, currentChannelId: null };
    const pinia = Reflect.ownKeys(provides).map((key) => provides[key]).find((value) => value && typeof value === "object" && "_s" in value) as { _s?: Map<string, Record<string, unknown>> } | undefined;
    const store = [...(pinia?._s?.values() || [])].find((candidate) => "connectionState" in candidate && "currentChannelId" in candidate);
    const socket = store?.socket as { connected?: boolean } | undefined;
    return {
      storeFound: Boolean(store),
      connectionState: typeof store?.connectionState === "string" ? store.connectionState : null,
      socketPresent: Boolean(socket),
      socketConnected: socket?.connected === true,
      currentChannelId: typeof store?.currentChannelId === "number" ? store.currentChannelId : null
    };
  });
}

export async function waitForChatSocket(page: Page) {
  await expect.poll(() => readChatConnection(page).then((state) => state.socketConnected), { timeout: 15_000 }).toBe(true);
}
