import assert from "node:assert/strict";
import test from "node:test";
import {
  composerDraftAfterSend,
  isComposerSendKey,
  isTouchDevice,
  type MessageSendAck,
  type MessageSendResult,
  type MessageSendSocket,
  useMessageSender
} from "./messageSending";

class FakeSocket implements MessageSendSocket {
  connected = false;
  emitCount = 0;
  timeoutMs = 0;
  payloads: unknown[] = [];
  private acknowledgements: Array<(error: Error | null, response?: MessageSendAck) => void> = [];

  timeout(timeoutMs: number) {
    this.timeoutMs = timeoutMs;
    return this;
  }

  emit(_event: "message:send", payload: unknown, ack: (error: Error | null, response?: MessageSendAck) => void) {
    this.emitCount += 1;
    this.payloads.push(payload);
    this.acknowledgements.push(ack);
    return this;
  }

  acknowledge(error: Error | null, response?: MessageSendAck, index = 0) {
    this.acknowledgements[index]?.(error, response);
  }
}

const payload = { channelId: 1, content: "保留这条消息", type: "text", replyToId: null };

test("disconnected sends are rejected without emitting and the draft is retained", async () => {
  const socket = new FakeSocket();
  const sender = useMessageSender({ getSocket: () => socket });

  const result = await sender.send(payload);

  assert.deepEqual(result, { ok: false, reason: "disconnected", message: "连接恢复后再发送" });
  assert.equal(socket.emitCount, 0);
  assert.equal(composerDraftAfterSend(result, "保留这条消息", "保留这条消息"), "保留这条消息");
});

test("the original draft can be sent after the socket reconnects and clears only after success ACK", async () => {
  const socket = new FakeSocket();
  const sender = useMessageSender({ getSocket: () => socket });
  socket.connected = true;

  const sending = sender.send(payload);
  assert.equal(sender.pending.value, true);
  assert.equal(socket.emitCount, 1);
  assert.deepEqual(socket.payloads, [payload]);
  socket.acknowledge(null, { success: true });
  const result = await sending;

  assert.deepEqual(result, { ok: true });
  assert.equal(sender.pending.value, false);
  assert.equal(composerDraftAfterSend(result, "保留这条消息", "保留这条消息"), "");
});

test("a failed ACK keeps the submitted draft and exposes the server message", async () => {
  const socket = new FakeSocket();
  socket.connected = true;
  const sender = useMessageSender({ getSocket: () => socket });

  const sending = sender.send(payload);
  socket.acknowledge(null, { success: false, message: "服务端拒绝了消息" });
  const result = await sending;

  assert.deepEqual(result, { ok: false, reason: "rejected", message: "服务端拒绝了消息" });
  assert.equal(sender.statusMessage.value, "服务端拒绝了消息");
  assert.equal(composerDraftAfterSend(result, "保留这条消息", "保留这条消息"), "保留这条消息");
});

test("an ACK timeout keeps the draft and does not automatically retry", async () => {
  const socket = new FakeSocket();
  socket.connected = true;
  const sender = useMessageSender({ getSocket: () => socket, timeoutMs: 25 });

  const sending = sender.send(payload);
  socket.acknowledge(new Error("operation has timed out"));
  const result = await sending;

  assert.equal(result.ok, false);
  assert.equal((result as Extract<MessageSendResult, { ok: false }>).reason, "timeout");
  assert.match((result as Extract<MessageSendResult, { ok: false }>).message, /内容已保留/);
  assert.equal(composerDraftAfterSend(result, "保留这条消息", "保留这条消息"), "保留这条消息");
  assert.equal(socket.timeoutMs, 25);
  assert.equal(socket.emitCount, 1);
});

test("a pending send blocks duplicate clicks and Enter submissions", async () => {
  const socket = new FakeSocket();
  socket.connected = true;
  const sender = useMessageSender({ getSocket: () => socket });

  const first = sender.send(payload);
  const duplicate = await sender.send(payload);

  assert.deepEqual(duplicate, { ok: false, reason: "busy", message: "消息正在发送，请稍候" });
  assert.equal(socket.emitCount, 1);
  socket.acknowledge(null, { success: true });
  await first;
});

test("new edits made while an ACK is pending are not cleared by the earlier success", () => {
  const sent: MessageSendResult = { ok: true };
  assert.equal(composerDraftAfterSend(sent, "原消息", "原消息后续编辑"), "原消息后续编辑");
});

test("Enter sends, Shift+Enter inserts a newline, and composition Enter is ignored", () => {
  assert.equal(isComposerSendKey({ key: "Enter", shiftKey: false, isComposing: false }), true);
  assert.equal(isComposerSendKey({ key: "Enter", shiftKey: true, isComposing: false }), false);
  assert.equal(isComposerSendKey({ key: "Enter", shiftKey: false, isComposing: true }), false);
});

test("isTouchDevice is false outside a browser", () => {
  assert.equal(isTouchDevice(), false);
});

test("isTouchDevice is true when the primary pointer is coarse", () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  try {
    Object.defineProperty(globalThis, "window", {
      value: { matchMedia: (query: string) => ({ matches: query === "(pointer: coarse)" }) },
      configurable: true
    });
    Object.defineProperty(globalThis, "navigator", { value: { maxTouchPoints: 0 }, configurable: true });
    assert.equal(isTouchDevice(), true);
  } finally {
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
  }
});

test("isTouchDevice falls back to maxTouchPoints when pointer is fine", () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  try {
    Object.defineProperty(globalThis, "window", {
      value: { matchMedia: () => ({ matches: false }) },
      configurable: true
    });
    Object.defineProperty(globalThis, "navigator", { value: { maxTouchPoints: 2 }, configurable: true });
    assert.equal(isTouchDevice(), true);
  } finally {
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
  }
});
