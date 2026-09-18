import assert from "node:assert/strict";
import test from "node:test";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import type { MessageDTO } from "../../../shared/types";
import { useMessageRecall } from "./useMessageRecall";
import { useChatStore } from "../../store";

function message(overrides: Partial<MessageDTO> = {}): MessageDTO {
  return {
    id: 21,
    channelId: 3,
    sender: { id: 2, kind: "human", username: "member", displayName: "成员" },
    content: "旧消息",
    type: "text",
    createdAt: "2026-09-17T00:00:00.000Z",
    ...overrides
  };
}

test("administrators can permanently delete another sender's old message", async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  });
  setActivePinia(createPinia());
  try {
    let request: { url: string; method?: string } | undefined;
    globalThis.fetch = async (input, init) => {
      request = { url: String(input), method: init?.method };
      return new Response(JSON.stringify({ success: true, deleted: 1 }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const store = useChatStore();
    store.loadMessages = async () => {};
    const pendingMessage = message();
    const pendingMessageActions = ref<MessageDTO | null>(pendingMessage);
    const recall = useMessageRecall({
      pendingMessageActions,
      isMine: () => false,
      isAdmin: ref(true),
      positionPromptNearEvent: () => ({ x: 0, y: 0 }),
      closeChainJoin: () => {},
      closeMessageActionMenu: () => {},
      closeCompetingPrompts: () => {}
    });

    assert.equal(recall.canRemoveMessage(pendingMessage), true);
    assert.equal(recall.removeActionText(pendingMessage), "删除");
    recall.recallActionMessage();
    await recall.recallPendingMessage();
    assert.deepEqual(request, { url: "/api/admin/messages/21", method: "DELETE" });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocalStorage) Object.defineProperty(globalThis, "localStorage", { configurable: true, value: originalLocalStorage });
    else delete (globalThis as { localStorage?: Storage }).localStorage;
  }
});
