import assert from "node:assert/strict";
import test from "node:test";
import type { MessageDTO } from "./types.js";
import {
  DEFAULT_WECHAT_RELAY_TEMPLATES,
  renderWeChatRelayNotification,
  weChatRelayTemplateKey
} from "./wechatRelayNotifications.js";

function message(id: number, overrides: Partial<MessageDTO> = {}): MessageDTO {
  return {
    id,
    channelId: 7,
    sender: { id: 3, kind: "human", username: "sender", displayName: "小夏" },
    content: "不应出现在微信里的正文",
    type: "text",
    createdAt: "2026-08-21T00:00:00.000Z",
    ...overrides
  };
}

test("classifies conversational relay events", () => {
  assert.equal(weChatRelayTemplateKey(message(1)), "message");
  assert.equal(weChatRelayTemplateKey(message(2, { content: "你好 @小明，看看这里" })), "mention");
  assert.equal(weChatRelayTemplateKey(message(3, { content: "@@诗歌", type: "text" })), "message");
  assert.equal(weChatRelayTemplateKey(message(4, { type: "prayer", payload: {} })), "prayer");
  assert.equal(weChatRelayTemplateKey(message(5, { type: "prayer", payload: { sourcePrayerMessageId: 4 } })), "prayerUpdate");
  assert.equal(weChatRelayTemplateKey(message(6, { type: "image" })), "attachment");
});

test("renders deterministic varied reminders without message content, ids, or timestamps", () => {
  const first = renderWeChatRelayNotification(message(1));
  const second = renderWeChatRelayNotification(message(2));
  assert.notEqual(first, second);
  assert.equal(first, renderWeChatRelayNotification(message(1)));
  for (const rendered of [first, second]) {
    assert.match(rendered, /小夏/);
    assert.doesNotMatch(rendered, /不应出现在微信里的正文|#1|#2|2026/);
  }
});

test("uses editable templates and replaces supported placeholders", () => {
  const templates = { ...DEFAULT_WECHAT_RELAY_TEMPLATES, attachment: ["{name}刚发来了{kind}"] };
  assert.equal(renderWeChatRelayNotification(message(8, { type: "image" }), templates), "小夏刚发来了一张图片");
});
