import assert from "node:assert/strict";
import test from "node:test";
import {
  appendChainParticipant,
  createChainPayload,
  normalizeChainOptionLabels
} from "./chainService.js";

test("normalizes required chain choices without changing legacy chains", () => {
  assert.deepEqual(createChainPayload("普通接龙"), { topic: "普通接龙", participants: [] });
  assert.deepEqual(normalizeChainOptionLabels([" 跑步 ", "羽毛球", "跑步", "其他", ""]), ["跑步", "羽毛球"]);
  assert.deepEqual(createChainPayload("今天锻炼", { requiredSelection: true, options: ["跑步", "游泳"] }), {
    topic: "今天锻炼",
    schemaVersion: 2,
    participation: {
      mode: "required_single_choice",
      options: [
        { id: "option-1", label: "跑步" },
        { id: "option-2", label: "游泳" }
      ],
      allowCustom: true
    },
    participants: []
  });
});

test("requires and validates a configured chain choice", () => {
  const payload = createChainPayload("今天锻炼", { requiredSelection: true, options: ["跑步", "游泳"] });
  assert.deepEqual(appendChainParticipant(payload, { id: 2, displayName: "小明" }, undefined, "2026-09-01T00:00:00Z"), {
    success: false,
    status: 400,
    message: "请选择具体项目后再参与接龙"
  });
  assert.deepEqual(appendChainParticipant(payload, { id: 2, displayName: "小明" }, { kind: "option", optionId: "missing" }, "2026-09-01T00:00:00Z"), {
    success: false,
    status: 400,
    message: "所选接龙项目无效，请重新选择"
  });
  const joined = appendChainParticipant(payload, { id: 2, displayName: "小明" }, { kind: "option", optionId: "option-1" }, "2026-09-01T00:00:00Z");
  assert.equal(joined.success, true);
  if (!joined.success) return;
  assert.deepEqual(joined.payload.participants[0], {
    actorId: 2,
    name: "小明",
    text: "跑步",
    at: "2026-09-01T00:00:00Z",
    selection: { kind: "option", optionId: "option-1", label: "跑步" }
  });
  assert.equal(payload.participants.length, 0);
});

test("stores custom choices in both structured and legacy display fields", () => {
  const payload = createChainPayload("今天锻炼", { requiredSelection: true, options: ["跑步"] });
  const joined = appendChainParticipant(payload, { id: 3, displayName: "小雨" }, { kind: "custom", text: " 骑行 30 分钟 " }, "2026-09-01T00:00:00Z");
  assert.equal(joined.success, true);
  if (!joined.success) return;
  assert.deepEqual(joined.payload.participants[0], {
    actorId: 3,
    name: "小雨",
    text: "其他：骑行 30 分钟",
    at: "2026-09-01T00:00:00Z",
    selection: { kind: "custom", label: "骑行 30 分钟" }
  });
  assert.deepEqual(appendChainParticipant(joined.payload, { id: 3, displayName: "小雨" }, { kind: "custom", text: "爬山" }, "2026-09-01T00:01:00Z"), {
    success: false,
    status: 409,
    message: "你已经参与过这个接龙"
  });
});
