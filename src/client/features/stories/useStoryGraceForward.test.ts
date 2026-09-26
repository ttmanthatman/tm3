import assert from "node:assert/strict";
import test from "node:test";
import { effectScope, ref } from "vue";
import type { ChannelDTO, MessageDTO } from "@shared/types";
import type { StoryDTO } from "@shared/stories";
import { useStoryGraceForward } from "./useStoryGraceForward";

const channel = (id: number, kind = "standard", canWrite = true) => ({ id, name: `频道 ${id}`, kind, canWrite } as ChannelDTO);
const story: StoryDTO = { id: 17, text: "见证", createdAt: "2026-09-27T00:00:00Z", media: [], interactions: { liked: false, likeCount: 0, likes: [], commentCount: 0, comments: [] } };
const message: MessageDTO = { id: 55, channelId: 7, type: "grace", content: "见证", sender: { id: 22, kind: "human", username: "writer", displayName: "作者" }, createdAt: "2026-09-27T00:00:00Z" };

test("targets exclude read-only and special channels and default to the current writable chat", () => {
  const channels = ref([channel(7), channel(8, "direct"), channel(9, "standard", false), channel(10, "music")]);
  const f = useStoryGraceForward({ channels: () => channels.value, currentChannelId: () => 7, onForwarded: () => {} });
  f.open(story);
  assert.equal(f.channelId.value, 7);
  assert.deepEqual(f.targetChannels.value.map((row) => row.id), [7, 8]);
  assert.equal(f.canSubmit.value, true);
  channels.value = [];
  assert.equal(f.canSubmit.value, false);
  f.close();
  f.open(story);
  assert.equal(f.channelId.value, null);
});

test("a failed submission keeps the selection and request ID; a retry cannot submit twice", async () => {
  const ids: string[] = [];
  const submitted: number[] = [];
  const f = useStoryGraceForward({ channels: () => [channel(7)], currentChannelId: () => 7, onForwarded: (card) => submitted.push(card.id), forward: async (_story, _channel, id) => {
    ids.push(id);
    if (ids.length === 1) throw new Error("网络失败");
    return { success: true, message };
  } });
  f.open(story);
  await f.submit();
  assert.equal(f.forwardError.value, "网络失败");
  assert.equal(f.channelId.value, 7);
  assert.equal(f.forwardOpen.value, true);
  await Promise.all([f.submit(), f.submit()]);
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
  assert.deepEqual(submitted, [55]);
  assert.equal(f.result.value?.id, 55);
  assert.equal(f.canSubmit.value, false);
  assert.equal(f.targetName.value, "频道 7");
});

test("changing the target after failure or opening a fresh forward uses a new request ID", async () => {
  const ids: string[] = [];
  const f = useStoryGraceForward({ channels: () => [channel(7), channel(8)], currentChannelId: () => 7, onForwarded: () => {}, forward: async (_story, _channel, id) => { ids.push(id); throw new Error("失败"); } });
  f.open(story);
  await f.submit();
  f.channelId.value = 8;
  await f.submit();
  f.close();
  f.open(story);
  await f.submit();
  assert.equal(new Set(ids).size, 3);
});

test("busy forwarding blocks close and disposal aborts without applying a late response", async () => {
  const scope = effectScope();
  let requestSignal: AbortSignal | undefined;
  let finish: ((value: { success: true; message: MessageDTO }) => void) | undefined;
  let applied = false;
  const f = scope.run(() => useStoryGraceForward({ channels: () => [channel(7)], currentChannelId: () => 7, onForwarded: () => { applied = true; }, forward: async (_story, _channel, _id, signal) => {
    requestSignal = signal;
    return new Promise((resolve) => { finish = resolve; });
  } }))!;
  f.open(story);
  const pending = f.submit();
  assert.equal(f.forwardBusy.value, true);
  f.close();
  assert.equal(f.forwardOpen.value, true);
  scope.stop();
  assert.equal(requestSignal?.aborted, true);
  finish!({ success: true, message });
  await pending;
  assert.equal(applied, false);
});
