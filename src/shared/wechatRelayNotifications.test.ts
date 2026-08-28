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
  assert.equal(weChatRelayTemplateKey(message(6, { type: "image" })), "image");
  assert.equal(weChatRelayTemplateKey(message(7, { type: "file", payload: { kind: "voice" } })), "voice");
  assert.equal(weChatRelayTemplateKey(message(8, { type: "system", payload: { systemKind: "pinned" } })), "pinned");
  assert.equal(weChatRelayTemplateKey(message(9, { type: "system", payload: { systemKind: "versionUpdate" } })), "versionUpdate");
  assert.equal(weChatRelayTemplateKey(message(10, { type: "why_topic_card" })), "whyTopic");
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
  const templates = { ...DEFAULT_WECHAT_RELAY_TEMPLATES, image: ["{name}在{channel}刚发来了{kind}"] };
  assert.equal(renderWeChatRelayNotification(message(8, { type: "image" }), templates, { channel: "综合频道" }), "小夏在综合频道刚发来了一张图片");
});

test("renders mapped mentions, content metadata, and configurable system prefixes", () => {
  const mentioned = [{ accountId: 9, displayName: "小明", username: "ming", wechatName: "明明" }];
  const mentionTemplates = {
    ...DEFAULT_WECHAT_RELAY_TEMPLATES,
    mention: ["{name}在{channel}@了{mentions}（微信：{wechatMentions}），共{mentionCount}人、可推送{wechatMentionCount}人：{content}"]
  };
  assert.equal(
    renderWeChatRelayNotification(message(10, { content: "<p>@小明 请看安排</p>" }), mentionTemplates, { channel: "综合频道", mentions: mentioned }),
    "小夏在综合频道@了小明（微信：明明），共1人、可推送1人：@小明 请看安排"
  );
  const systemTemplates = { ...DEFAULT_WECHAT_RELAY_TEMPLATES, versionUpdate: ["【{systemPrefix}】升级到 {version}"] };
  assert.equal(renderWeChatRelayNotification(message(11, {
    type: "system",
    content: "",
    payload: { systemKind: "versionUpdate", version: "1.13.0" }
  }), systemTemplates, { systemPrefix: "站务", version: "1.13.0" }), "【站务】升级到 1.13.0");
  const changelogTemplates = { ...DEFAULT_WECHAT_RELAY_TEMPLATES, versionUpdate: ["【{systemPrefix}】升级到 v{version}，更新内容：{changelog}"] };
  assert.equal(renderWeChatRelayNotification(message(12, {
    type: "system",
    content: "",
    payload: { systemKind: "versionUpdate", version: "1.13.0", changelog: "修复已知问题\n新增提醒功能" }
  }), changelogTemplates, { systemPrefix: "站务" }), "【站务】升级到 v1.13.0，更新内容：修复已知问题\n新增提醒功能");
  assert.equal(renderWeChatRelayNotification(message(13, {
    type: "system",
    content: "",
    payload: { systemKind: "versionUpdate", version: "1.13.0" }
  }), changelogTemplates, { systemPrefix: "站务", changelog: "修复已知问题" }), "【站务】升级到 v1.13.0，更新内容：修复已知问题");
});
