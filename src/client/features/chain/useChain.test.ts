import assert from "node:assert/strict";
import test from "node:test";
import { ref } from "vue";
import type { MessageDTO } from "../../../shared/types";
import { useChain } from "./useChain";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function installLocalStorage() {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete (globalThis as { localStorage?: Storage }).localStorage;
  };
}

function chainMessage(): MessageDTO {
  return {
    id: 12,
    channelId: 9,
    sender: { id: 3, kind: "human", username: "owner", displayName: "发起人" },
    content: "今天锻炼",
    type: "chain",
    payload: { topic: "今天锻炼", participants: [] },
    chainRootId: 12,
    createdAt: "2026-09-01T00:00:00Z"
  };
}

test("sends required choices when creating a chain", async () => {
  const originalFetch = globalThis.fetch;
  const restoreLocalStorage = installLocalStorage();
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body || "{}"));
    return jsonResponse({ success: true });
  };
  try {
    const chain = useChain({ currentChannelId: ref(9), getReplyToId: () => 4 });
    chain.openCreateDialog();
    await chain.createChain({ topic: "今天锻炼", requiredSelection: true, allowMultiple: true, options: ["跑步", "游泳"] });
    assert.deepEqual(requestBody, {
      channelId: 9,
      type: "chain",
      chainTopic: "今天锻炼",
      chainConfig: { requiredSelection: true, allowMultiple: true, options: ["跑步", "游泳"] },
      replyToId: 4
    });
    assert.equal(chain.showCreateDialog.value, false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreLocalStorage();
  }
});

test("sends all selected projects for a multi-select chain", async () => {
  const originalFetch = globalThis.fetch;
  const restoreLocalStorage = installLocalStorage();
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body || "{}"));
    return jsonResponse({ success: true });
  };
  try {
    const chain = useChain({ currentChannelId: ref(9), getReplyToId: () => null });
    chain.openJoin(chainMessage());
    await chain.joinPendingChain({ kind: "multiple", optionIds: ["option-1", "option-2"], customText: "自带水杯" });
    assert.deepEqual(requestBody, {
      channelId: 9,
      type: "chain",
      chainRootId: 12,
      chainSelection: { kind: "multiple", optionIds: ["option-1", "option-2"], customText: "自带水杯" }
    });
  } finally {
    globalThis.fetch = originalFetch;
    restoreLocalStorage();
  }
});

test("sends the selected project and preserves the picker after a failure", async () => {
  const originalFetch = globalThis.fetch;
  const restoreLocalStorage = installLocalStorage();
  const bodies: Array<Record<string, unknown>> = [];
  let responseStatus = 200;
  globalThis.fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body || "{}")));
    return responseStatus === 200 ? jsonResponse({ success: true }) : jsonResponse({ message: "请选择具体项目后再参与接龙" }, responseStatus);
  };
  try {
    const chain = useChain({ currentChannelId: ref(9), getReplyToId: () => null });
    chain.openJoin(chainMessage());
    responseStatus = 400;
    await chain.joinPendingChain();
    assert.equal(chain.pendingChain.value?.id, 12);
    assert.equal(chain.joinError.value, "请选择具体项目后再参与接龙");

    responseStatus = 200;
    await chain.joinPendingChain({ kind: "option", optionId: "option-1" });
    assert.deepEqual(bodies.at(-1), {
      channelId: 9,
      type: "chain",
      chainRootId: 12,
      chainSelection: { kind: "option", optionId: "option-1" }
    });
    assert.equal(chain.pendingChain.value, null);
  } finally {
    globalThis.fetch = originalFetch;
    restoreLocalStorage();
  }
});
