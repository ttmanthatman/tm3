import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_AI_CONVERSATION } from "../../shared/aiConversation.js";
import { createConversationController } from "./conversation.js";
const config = { ...DEFAULT_AI_CONVERSATION, enabled: true, characterIds: [1, 2], intervalSeconds: 0 };
async function until(predicate: () => boolean) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 2)); }
  assert.fail("condition did not complete");
}
test("characters start autonomously, alternate and publish exactly the message limit", async () => {
  const sent: number[] = [];
  const controller = createConversationController({
    prepare: async (_channel, id) => ({actorId: id, messages: [{role:"user",content:"hello"}]}),
    generate: async () => "answer",
    publish: async (_channel, actor) => { sent.push(actor); }
  });
  try {
    await controller.start(7, { ...config, maxMessages: 3 });
    await until(() => controller.status(7).state === "completed");
    assert.deepEqual(sent, [1, 2, 1]);
    assert.equal(controller.status(7).messages, 3);
  } finally { await controller.stopAll(); }
});
test("cumulative context budget rejects the next request before spending it", async () => {
  let requests = 0;
  const controller = createConversationController({
    prepare: async () => ({actorId:1,messages:[{role:"system",content:"123456"}]}),
    generate: async () => { requests++; return "answer"; }, publish: async () => {}
  });
  try {
    await controller.start(7, {...config,maxContextChars:10});
    await until(() => controller.status(7).state === "completed");
    assert.equal(requests,1); assert.equal(controller.status(7).contextChars,6);
    assert.equal(controller.status(7).messages,1);
  } finally { await controller.stopAll(); }
});
test("pause cancels generation, discards a late reply and resume keeps counters", async () => {
  let release: ((text:string) => void) | undefined; let signal: AbortSignal | undefined; let published = 0;
  const controller = createConversationController({
    prepare: async () => ({actorId:1,messages:[{role:"user",content:"hello"}]}),
    generate: async (_turn, received) => {signal=received; return new Promise<string>((resolve) => {release=resolve;});},
    publish: async () => { published++; }
  });
  try {
    await controller.start(7, {...config,maxMessages:1}); await until(() => !!release);
    const paused = controller.control(7,"pause"); assert.equal(signal?.aborted,true);
    release!("late"); await paused; assert.equal(published,0);
    assert.equal(controller.status(7).contextChars,5); release=undefined;
    await controller.control(7,"resume"); await until(() => !!release);
    release!("new"); await until(() => controller.status(7).state === "completed");
    assert.equal(published,1); assert.equal(controller.status(7).contextChars,10);
  } finally { await controller.stopAll(); }
});
test("time limit aborts in-flight generation and a late reply cannot publish", async () => {
  let release: ((text:string)=>void) | undefined; let signal: AbortSignal | undefined;
  const controller = createConversationController({
    prepare: async () => ({actorId:1,messages:[{role:"user",content:"hello"}]}),
    generate: async (_turn, received) => {signal=received; return new Promise<string>((resolve)=>{release=resolve;});},
    publish: async () => { assert.fail("must not publish"); }
  });
  await controller.start(7,{...config,maxDurationSeconds:0.02});
  await until(() => controller.status(7).state === "completed");
  assert.equal(signal?.aborted,true); release!("late"); await controller.stopAll();
});
test("removed or disabled character during generation stops before publication", async () => {
  let prepares = 0;
  const controller = createConversationController({
    prepare: async () => {if (++prepares > 1) throw new Error("removed"); return {actorId:1,messages:[{role:"user",content:"hello"}]};},
    generate: async () => "answer", publish: async () => {assert.fail("must not publish");}
  });
  try { await controller.start(7,config); await until(()=>controller.status(7).state === "error"); assert.equal(controller.status(7).messages,0); }
  finally { await controller.stopAll(); }
});
test("stop waits for a started database write and prevents later turns", async () => {
  let release: (()=>void) | undefined; let requests = 0;
  const controller = createConversationController({
    prepare: async () => ({actorId:1,messages:[{role:"user",content:"hello"}]}),
    generate: async () => {requests++;return "answer";},
    publish: async () => new Promise<void>((resolve)=>{release=resolve;})
  });
  await controller.start(7,config); await until(()=>!!release);
  const stopped = controller.control(7,"stop"); release!(); await stopped;
  assert.equal(controller.status(7).state,"stopped"); assert.equal(controller.status(7).messages,1);
  assert.equal(requests,1); await controller.stopAll();
});
