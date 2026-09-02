import assert from "node:assert/strict";
import test from "node:test";
import type { MessageDTO } from "../../../shared/types";
import { chainParticipantProject, chainPayload, chainRequiresSelection } from "./chain";

function message(payload: unknown): MessageDTO {
  return {
    id: 1,
    channelId: 2,
    sender: { id: 3, kind: "human", username: "user", displayName: "用户" },
    content: "今天锻炼",
    type: "chain",
    payload,
    createdAt: "2026-09-01T00:00:00Z"
  };
}

test("keeps legacy chain payloads name-only", () => {
  const legacy = message({ topic: "普通接龙", participants: [{ actorId: 1, name: "小明", text: "", at: "now" }] });
  assert.equal(chainRequiresSelection(legacy), false);
  assert.equal(chainPayload(legacy).topic, "普通接龙");
});

test("reads required choices and participant projects", () => {
  const configured = message({
    topic: "今天锻炼",
    schemaVersion: 2,
    participation: {
      mode: "required_single_choice",
      options: [{ id: "option-1", label: "跑步" }],
      allowCustom: true
    },
    participants: []
  });
  assert.equal(chainRequiresSelection(configured), true);
  assert.deepEqual(chainPayload(configured).participation?.options, [{ id: "option-1", label: "跑步" }]);
  assert.equal(chainParticipantProject({ actorId: 1, name: "小明", text: "跑步", at: "now" }), "跑步");
  assert.equal(chainParticipantProject({
    actorId: 2,
    name: "小雨",
    text: "其他：骑行",
    at: "now",
    selection: { kind: "custom", label: "骑行" }
  }), "其他：骑行");
});

test("reads multi-select chains and formats all selected projects", () => {
  const configured = message({
    topic: "周末活动",
    schemaVersion: 2,
    participation: {
      mode: "required_multiple_choice",
      options: [
        { id: "option-1", label: "跑步" },
        { id: "option-2", label: "游泳" }
      ],
      allowCustom: true
    },
    participants: []
  });
  assert.equal(chainRequiresSelection(configured), true);
  assert.equal(chainPayload(configured).participation?.mode, "required_multiple_choice");
  assert.equal(chainParticipantProject({
    actorId: 3,
    name: "小林",
    text: "跑步、游泳、其他：带水",
    at: "now",
    selection: {
      kind: "multiple",
      options: [
        { optionId: "option-1", label: "跑步" },
        { optionId: "option-2", label: "游泳" }
      ],
      customLabel: "带水"
    }
  }), "跑步、游泳、其他：带水");
});
