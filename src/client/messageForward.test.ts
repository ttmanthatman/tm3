import assert from "node:assert/strict";
import test from "node:test";
import type { ChannelDTO, ChatRecordPayloadDTO, MessageDTO } from "../shared/types";
import {
  chatRecordItemUrl,
  chatRecordPreviewLines,
  chatRecordPreviewPayload,
  chatRecordPreviewTitle,
  forwardTargetChannels,
  forwardableMessages,
  isForwardableMessage
} from "./messageForward";

function message(partial: Partial<MessageDTO>): MessageDTO {
  return { id: 1, channelId: 1, type: "text", content: "hello", ...partial } as MessageDTO;
}

function channel(partial: Partial<ChannelDTO>): ChannelDTO {
  return { id: 1, kind: "standard", name: "频道", canWrite: true, ...partial } as ChannelDTO;
}

test("forwardableMessages keeps whitelist types and reports skippedCount", () => {
  const messages = [
    message({ id: 1, type: "text", content: "你好" }),
    message({ id: 2, type: "image" }),
    message({ id: 3, type: "file", fileName: "voice.webm" }),
    message({ id: 4, type: "chain" }),
    message({ id: 5, type: "prayer" }),
    message({ id: 6, type: "chat_record" }),
    message({ id: 7, type: "system" })
  ];
  const { supported, skippedCount } = forwardableMessages(messages);
  assert.deepEqual(supported.map((item) => item.id), [1, 2, 3]);
  assert.equal(skippedCount, 4);
});

test("forwardableMessages skips empty text and optimistic messages", () => {
  const messages = [
    message({ id: 1, type: "text", content: "   " }),
    message({ id: -5, type: "text", content: "还没发出去" }),
    message({ id: 2, type: "text", content: "可以转发" })
  ];
  const { supported, skippedCount } = forwardableMessages(messages);
  assert.deepEqual(supported.map((item) => item.id), [2]);
  assert.equal(skippedCount, 2);
  assert.equal(isForwardableMessage(message({ id: 3, type: "text", content: "" })), false);
});

test("forwardTargetChannels keeps standard and direct channels the user can write in", () => {
  const channels = [
    channel({ id: 1, kind: "standard" }),
    channel({ id: 2, kind: "direct", name: "私聊" }),
    channel({ id: 3, kind: "standard", canWrite: false }),
    channel({ id: 4, kind: "music" }),
    channel({ id: 5, kind: "reception" }),
    channel({ id: 6, kind: "why" })
  ];
  assert.deepEqual(forwardTargetChannels(channels).map((item) => item.id), [1, 2]);
});

test("chatRecordPreviewLines renders sender prefixes, type summaries, truncation, and maxLines", () => {
  const payload: ChatRecordPayloadDTO = {
    kind: "chat_record",
    title: "测试群的聊天记录",
    sourceChannelId: 1,
    itemCount: 6,
    truncated: true,
    items: [
      { senderName: "小明", type: "text", content: "早上好", createdAt: "2026-09-07T08:00:00.000Z" },
      { senderName: "小红", type: "image", createdAt: "2026-09-07T08:01:00.000Z" },
      { senderName: "小刚", type: "file", voiceDurationMs: 3200, createdAt: "2026-09-07T08:02:00.000Z" },
      { senderName: "小丽", type: "file", fileName: "周报.pdf", fileSize: 2048, createdAt: "2026-09-07T08:03:00.000Z" },
      { senderName: "小华", type: "text", content: "很长".repeat(40), createdAt: "2026-09-07T08:04:00.000Z" },
      { senderName: "第六人", type: "text", content: "不该出现", createdAt: "2026-09-07T08:05:00.000Z" }
    ]
  };
  const lines = chatRecordPreviewLines(payload);
  assert.equal(lines.length, 4);
  assert.equal(lines[0], "小明: 早上好");
  assert.equal(lines[1], "小红: [图片]");
  assert.equal(lines[2], "小刚: [语音]");
  assert.equal(lines[3], "小丽: [文件] 周报.pdf");
  const longLines = chatRecordPreviewLines(payload, 6);
  assert.equal(longLines.length, 6);
  assert.equal(longLines[4].endsWith("…"), true);
  assert.equal(longLines[4].startsWith("小华: "), true);
});

test("chatRecordItemUrl builds the item file URL with an encoded token", () => {
  assert.equal(chatRecordItemUrl(42, 3, "tok en+"), "/api/files/42?item=3&token=tok%20en%2B");
});

test("chatRecordPreviewPayload maps messages into preview items", () => {
  const title = chatRecordPreviewTitle("闲聊群");
  assert.equal(title, "闲聊群的聊天记录");
  const payload = chatRecordPreviewPayload(title, 7, [
    message({
      id: 9,
      type: "file",
      fileName: "voice.webm",
      payload: { kind: "voice", durationMs: 1500 },
      sender: { id: 1, kind: "human", username: "a", displayName: "阿明", avatarPath: "a.png" }
    })
  ]);
  assert.equal(payload.kind, "chat_record");
  assert.equal(payload.sourceChannelId, 7);
  assert.equal(payload.itemCount, 1);
  assert.equal(payload.items[0].type, "file");
  assert.equal(payload.items[0].voiceDurationMs, 1500);
  assert.equal(payload.items[0].senderAvatarPath, "a.png");
});
