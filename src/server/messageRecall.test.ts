import assert from "node:assert/strict";
import test from "node:test";
import { recalledMessageData } from "./messageRecall.js";

test("recalled messages discard their own reply preview", () => {
  assert.deepEqual(recalledMessageData("彩虹糖"), {
    type: "system",
    content: "彩虹糖 撤回了一条消息",
    payload: { recalled: true },
    fileName: null,
    filePath: null,
    fileSize: null,
    replyToId: null,
    chainRootId: null,
    chainVersion: null
  });
});
