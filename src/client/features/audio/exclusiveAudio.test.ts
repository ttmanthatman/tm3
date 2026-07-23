import assert from "node:assert/strict";
import test from "node:test";
import { createExclusiveAudio } from "./exclusiveAudio.js";

function createHarness() {
  const calls: string[] = [];
  const coordinator = createExclusiveAudio();
  const participant = (id: string, resumable = true) => ({
    id,
    resumable,
    suspend: () => calls.push(`${id}:suspend`),
    resume: () => calls.push(`${id}:resume`)
  });
  coordinator.register(participant("music"));
  coordinator.register(participant("friend"));
  coordinator.register(participant("voice", false));
  return { calls, coordinator };
}

test("activate 挂起当前播放者，再次 activate 恢复顺序正确", () => {
  const { calls, coordinator } = createHarness();
  coordinator.activate("music");
  assert.deepEqual(calls, []);
  assert.ok(coordinator.isActive("music"));

  coordinator.activate("friend");
  assert.deepEqual(calls, ["music:suspend"]);
  assert.ok(coordinator.isActive("friend"));
  assert.ok(coordinator.isSuspended("music"));

  coordinator.deactivate("friend", { resumeSuspended: true });
  assert.deepEqual(calls, ["music:suspend", "music:resume"]);
  assert.ok(coordinator.isActive("music"));
});

test("用户手动暂停不触发续播", () => {
  const { calls, coordinator } = createHarness();
  coordinator.activate("music");
  coordinator.activate("friend");
  coordinator.deactivate("friend");
  assert.deepEqual(calls, ["music:suspend"]);
  assert.equal(coordinator.activeId(), null);
  assert.ok(coordinator.isSuspended("music"));
});

test("不可续播的参与者不会进入续播栈", () => {
  const { calls, coordinator } = createHarness();
  coordinator.activate("music");
  coordinator.activate("voice");
  assert.deepEqual(calls, ["music:suspend"]);
  coordinator.activate("friend");
  assert.deepEqual(calls, ["music:suspend", "voice:suspend"]);
  coordinator.deactivate("friend", { resumeSuspended: true });
  assert.deepEqual(calls, ["music:suspend", "voice:suspend", "music:resume"]);
});

test("被挂起参与者再次 activate 时从续播栈移除且不重复挂起", () => {
  const { calls, coordinator } = createHarness();
  coordinator.activate("music");
  coordinator.activate("friend");
  coordinator.activate("music");
  assert.deepEqual(calls, ["music:suspend", "friend:suspend"]);
  assert.ok(coordinator.isActive("music"));
  assert.ok(!coordinator.isSuspended("music"));
  assert.ok(coordinator.isSuspended("friend"));
});

test("deactivate 非当前播放者只清理续播栈", () => {
  const { calls, coordinator } = createHarness();
  coordinator.activate("music");
  coordinator.activate("friend");
  coordinator.deactivate("music");
  assert.deepEqual(calls, ["music:suspend"]);
  assert.ok(coordinator.isActive("friend"));
  coordinator.deactivate("friend", { resumeSuspended: true });
  assert.deepEqual(calls, ["music:suspend"], "已移除的参与者不应再被续播");
  assert.equal(coordinator.activeId(), null);
});
