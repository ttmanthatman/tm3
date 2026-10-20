import assert from "node:assert/strict";
import test from "node:test";
import type { MessageDTO } from "@shared/types";
import { messageScriptureOnlyReference } from "./messageRendering";

// 极简 DOM 垫片：messageScriptureOnlyReference 里的 plainTextFromHtml 只用
// createElement("div") + innerHTML/textContent，这里按「剥标签」等价实现即可。
class FakeElement {
  innerHTML = "";
  get textContent() {
    return this.innerHTML.replace(/<[^>]+>/g, " ");
  }
}
(globalThis as { document?: unknown }).document = { createElement: () => new FakeElement() };

const textMessage = (content: string) => ({ id: 1, type: "text", content }) as unknown as MessageDTO;

test("整条消息只有一个经文引用时返回引用原文", () => {
  assert.equal(messageScriptureOnlyReference(textMessage("约翰福音 3:16")), "约翰福音 3:16");
  assert.equal(messageScriptureOnlyReference(textMessage("约3:16")), "约3:16");
  assert.equal(messageScriptureOnlyReference(textMessage("约翰福音 3:16-18")), "约翰福音 3:16-18");
  assert.equal(messageScriptureOnlyReference(textMessage("诗篇 23:1")), "诗篇 23:1");
});

test("夹杂其他文字、多个引用或非文本消息不算纯经文", () => {
  assert.equal(messageScriptureOnlyReference(textMessage("我们看约翰福音 3:16")), null);
  assert.equal(messageScriptureOnlyReference(textMessage("约翰福音 3:16 约翰福音 3:17")), null);
  assert.equal(messageScriptureOnlyReference(textMessage("约翰福音 3:16。")), null, "句号属于额外文字");
  assert.equal(messageScriptureOnlyReference(textMessage("")), null);
  assert.equal(messageScriptureOnlyReference(textMessage("看看：<b>约翰福音 3:16</b>")), null);
  assert.equal(messageScriptureOnlyReference({ ...textMessage("约翰福音 3:16"), type: "image" }), null);
});

test("纯标签包裹的引用剥掉标签后仍是纯经文", () => {
  assert.equal(messageScriptureOnlyReference(textMessage("<b>约翰福音 3:16</b>")), "约翰福音 3:16");
});
