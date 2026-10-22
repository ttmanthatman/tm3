import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { createVirtualDirectAssistant, type VirtualDirectAssistantDependencies, type VirtualDirectAssistantSettings } from "./virtualDirectAssistant.js";

function createHarness(username = "story_friend") {
  const sender = { id: 1, kind: "human", accountId: 7, displayName: "提问者" };
  const channel = { id: 30, kind: "direct", name: "私聊：提问者、故事朋友", directKey: `virtual:7:${username}` };
  const actor = {
    id: 2, kind: "virtual", username, displayName: "故事朋友", status: "active",
    character: { enabled: true, config: { persona: "陪伴读书", memory: "熟悉的故事" } } as { enabled: boolean; config: { persona: string; memory: string } } | null
  };
  type Row = { id: number; channelId: number; senderActorId: number; content: string; type: string; createdAt: Date; payload?: unknown };
  const rows: Row[] = [];
  const add = (id: number, content: string, senderActorId = 1, channelId = 30) => {
    const row: Row = { id, content, senderActorId, channelId, type: "text", createdAt: new Date(2026, 9, 22, 1, 0, id) };
    rows.push(row);
    return row;
  };
  const message = add(50, "你好，今天一起读书吧");
  let allowed = true;
  let stopped = false;
  let lockDepth = 0;
  let onComplete: (() => void) | undefined;
  const calls = { settings: 0, complete: 0, stop: 0, send: [] as Parameters<VirtualDirectAssistantDependencies["send"]>[0][], contexts: [] as string[], query: [] as unknown[], permissions: [] as number[][] };
  const settings: VirtualDirectAssistantSettings = {
    enabled: true, apiKeyConfigured: true, baseUrl: "https://example.invalid/v1", model: "test-model",
    promptCommand: "角色：陪伴读书。记忆：熟悉的故事。", systemPrompt: "底层规则", cardCooldownSeconds: 1, userLimitPerMinute: 10, maxSuccessPerMessage: 1
  };
  let apiKey = "test-key";
  const prisma = {
    message: {
      findUnique: async ({ where }: { where: { id: number } }) => where.id === message.id ? { ...message, sender: { ...sender }, channel: { ...channel } } : null,
      findMany: async (query: { where: { channelId: number; id: { lte: number }; senderActorId: { in: number[] } }; take: number; orderBy: { id: string } }) => {
        calls.query.push(query);
        assert.equal(query.orderBy.id, "desc");
        return rows.filter((row) => row.channelId === query.where.channelId && row.id <= query.where.id.lte && query.where.senderActorId.in.includes(row.senderActorId))
          .sort((left, right) => right.id - left.id).slice(0, query.take);
      }
    },
    actor: { findUnique: async ({ where }: { where: { username: string } }) => where.username === actor.username ? structuredClone(actor) : null }
  } as unknown as PrismaClient;
  const deps: VirtualDirectAssistantDependencies = {
    prisma,
    canWriteChannel: async (accountId, channelId) => { calls.permissions.push([accountId, channelId]); return allowed; },
    loadSettings: async (requestedUsername, config) => {
      calls.settings += 1;
      assert.equal(requestedUsername, username);
      assert.deepEqual(config, actor.character?.config);
      return { value: settings, apiKey };
    },
    complete: async (value, key, contextText) => {
      calls.complete += 1;
      assert.equal(value, settings);
      assert.equal(key, "test-key");
      calls.contexts.push(contextText);
      onComplete?.();
      return "我们从这本书开始。";
    },
    send: async (input) => { assert.equal(lockDepth, 1); calls.send.push(input); },
    sessions: {
      exclusive: async (trigger, requestedUsername, action) => {
        assert.equal(trigger.id, message.id);
        assert.equal(requestedUsername, username);
        lockDepth += 1;
        try { return await action(); } finally { lockDepth -= 1; }
      },
      stoppedSince: async () => stopped,
      stop: async (trigger, assistant) => { calls.stop += 1; assert.equal(trigger.id, message.id); assert.equal(assistant.id, actor.id); }
    }
  };
  return { service: createVirtualDirectAssistant(deps), deps, message, sender, channel, actor, settings, calls, add,
    setAllowed: (value: boolean) => { allowed = value; }, setStopped: (value: boolean) => { stopped = value; },
    setOnComplete: (action: () => void) => { onComplete = action; }, setApiKey: (value: string) => { apiKey = value; } };
}

test("an ordinary direct message gets a role reply with only the same user's own DM history", async () => {
  const h = createHarness();
  h.add(1, "本次私聊的历史");
  h.add(2, "以前的助手回答", 2);
  h.add(3, "另一个频道的秘密", 1, 31);
  h.add(4, "其他发言人的秘密", 99);
  h.add(51, "当前消息之后的内容");
  await h.service.trigger(50);
  assert.equal(h.calls.complete, 1);
  assert.match(h.calls.contexts[0], /本次私聊的历史/);
  assert.match(h.calls.contexts[0], /以前的助手回答/);
  assert.match(h.calls.contexts[0], /你好，今天一起读书吧/);
  assert.doesNotMatch(h.calls.contexts[0], /另一个频道|其他发言人|当前消息之后/);
  assert.deepEqual(h.calls.query, [{ where: { channelId: 30, id: { lte: 50 }, senderActorId: { in: [1, 2] } }, orderBy: { id: "desc" }, take: 24 }]);
  assert.deepEqual(h.calls.send, [{ channelId: 30, actorId: 2, content: "我们从这本书开始。", replyToId: 50, payload: { contentFormat: "markdown", aiRole: "story_friend", triggerMessageId: 50 } }]);
  assert.deepEqual(h.calls.permissions, [[7, 30], [7, 30]]);
});

test("the why assistant also responds to ordinary private messages", async () => {
  const h = createHarness("why_assistant");
  await h.service.trigger(50);
  assert.equal(h.calls.complete, 1);
  assert.equal(h.calls.send[0]?.payload.aiRole, "why_assistant");
});

test("private messages with raw or persisted final-space opt-outs never call an assistant", async () => {
  for (const username of ["story_friend", "why_assistant"]) {
    for (const source of ["@故事朋友 你好？ ", "<p>你好？&nbsp;</p>", "persisted", "闭嘴 "]) {
      const h = createHarness(username);
      h.message.content = source === "persisted" ? "@故事朋友 你好？" : source;
      if (source === "persisted") h.message.payload = { aiActivationSuppressed: true };
      await h.service.trigger(h.message.id);
      assert.equal(h.calls.settings, 0, `${username}: ${source}`);
      assert.equal(h.calls.complete, 0);
      assert.equal(h.calls.stop, 0);
      assert.equal(h.calls.send.length, 0);
    }
  }
});

test("foreign direct keys, public channels, ai_slmm, non-human and non-text triggers are ignored", async () => {
  const cases = [
    (h: ReturnType<typeof createHarness>) => { h.channel.directKey = "virtual:8:story_friend"; },
    (h: ReturnType<typeof createHarness>) => { h.channel.directKey = "virtual:07:story_friend"; },
    (h: ReturnType<typeof createHarness>) => { h.channel.directKey = "7:8"; },
    (h: ReturnType<typeof createHarness>) => { h.channel.directKey = "virtual:7:story_friend:other"; },
    (h: ReturnType<typeof createHarness>) => { h.channel.kind = "standard"; },
    (h: ReturnType<typeof createHarness>) => { h.channel.directKey = "virtual:7:ai_slmm"; },
    (h: ReturnType<typeof createHarness>) => { h.sender.kind = "virtual"; },
    (h: ReturnType<typeof createHarness>) => { h.message.type = "image"; }
  ];
  for (const mutate of cases) {
    const h = createHarness(); mutate(h);
    await h.service.trigger(50);
    assert.equal(h.calls.settings, 0);
    assert.equal(h.calls.complete, 0);
    assert.deepEqual(h.calls.send, []);
    assert.equal(h.calls.stop, 0);
  }
});

test("disabled, missing or inactive characters and revoked write permission do not generate or stop", async () => {
  const cases = [
    (h: ReturnType<typeof createHarness>) => { h.actor.character!.enabled = false; },
    (h: ReturnType<typeof createHarness>) => { h.actor.character = null; },
    (h: ReturnType<typeof createHarness>) => { h.actor.status = "inactive"; },
    (h: ReturnType<typeof createHarness>) => { h.actor.kind = "human"; },
    (h: ReturnType<typeof createHarness>) => { h.setAllowed(false); }
  ];
  for (const content of ["你好", "安静"]) {
    for (const mutate of cases) {
      const h = createHarness(); h.message.content = content; mutate(h);
      await h.service.trigger(50);
      assert.equal(h.calls.settings, 0);
      assert.equal(h.calls.complete, 0);
      assert.equal(h.calls.stop, 0);
      assert.deepEqual(h.calls.send, []);
    }
  }
});

test("a private stop command ends the session without a model call or a reply", async () => {
  for (const content of ["安静", "闭嘴", "@故事朋友 你去买酱油吧", "你去跑步吧", "你去睡觉吧"]) {
    const h = createHarness(); h.message.content = content;
    await h.service.trigger(50);
    assert.equal(h.calls.stop, 1, content);
    assert.equal(h.calls.settings, 0);
    assert.equal(h.calls.complete, 0);
    assert.deepEqual(h.calls.send, []);
  }
});

test("a new private exchange excludes all history before the most recent stop command", async () => {
  const h = createHarness();
  h.add(1, "之前已经结束的话题");
  h.add(2, "之前已经结束的回复", 2);
  h.add(3, "@故事朋友 安静");
  h.add(4, "现在的新话题");
  await h.service.trigger(50);
  assert.match(h.calls.contexts[0], /现在的新话题/);
  assert.doesNotMatch(h.calls.contexts[0], /之前已经结束|@故事朋友 安静/);
});

test("stop commands arriving during generation suppress the pending answer", async () => {
  const h = createHarness();
  h.setOnComplete(() => h.setStopped(true));
  await h.service.trigger(50);
  assert.equal(h.calls.complete, 1);
  assert.deepEqual(h.calls.send, []);
});

test("a stop arriving during the final settings read suppresses the pending answer", async () => {
  const h = createHarness();
  const loadSettings = h.deps.loadSettings;
  h.deps.loadSettings = async (...args) => {
    const settings = await loadSettings(...args);
    if (h.calls.settings === 2) h.setStopped(true);
    return settings;
  };
  await h.service.trigger(50);
  assert.equal(h.calls.complete, 1);
  assert.equal(h.calls.settings, 2);
  assert.deepEqual(h.calls.send, []);
});

test("private tool results keep structured payloads and stop before subsequent messages", async () => {
  const h = createHarness();
  h.deps.complete = async (_settings, _key, _text, context) => {
    assert.deepEqual(context, { accountId: 7, channelId: 30, triggerMessageId: 50, assistantActorId: 2 });
    return { messages: [
      { content: "功能入口", payload: { assistantActions: [{ feature: "help", label: "使用说明" }] } },
      { content: "第二条结果", payload: {} }
    ], scoreIds: [] };
  };
  const send = h.deps.send;
  h.deps.send = async input => { await send(input); h.setStopped(true); };
  await h.service.trigger(50);
  assert.equal(h.calls.send.length, 1);
  assert.deepEqual(h.calls.send[0].payload.assistantActions, [{ feature: "help", label: "使用说明" }]);
  assert.equal(h.calls.send[0].payload.aiRole, "story_friend");
});

test("disabling functions after generation drops cards, songs, playlists and scores while keeping prose", async () => {
  const h = createHarness();
  let enabled = true;
  let scores = 0;
  h.deps.canUseFunctions = async () => enabled;
  h.deps.shareScore = async () => { scores++; };
  h.deps.complete = async () => {
    enabled = false;
    return { messages: [
      { content: "入口", payload: { assistantActions: [{ feature: "help", label: "使用说明" }] } },
      { content: "歌曲", payload: { musicTrackId: 7 } },
      { content: "经文", payload: { kind: "listen_playlist" } },
      { content: "未来功能结果", payload: {}, requiresFunctions: true },
      { content: "普通文字仍可回答", payload: {} }
    ], scoreIds: [30] };
  };
  await h.service.trigger(50);
  assert.deepEqual(h.calls.send.map(item => item.content), ["普通文字仍可回答"]);
  assert.equal(scores, 0);
});

test("a function switch changed during the final permission read still suppresses cards", async () => {
  const h = createHarness();
  let enabled = true;
  h.deps.canUseFunctions = async () => enabled;
  h.deps.complete = async () => ({ messages: [{ content: "入口", payload: { assistantActions: [{ feature: "help", label: "使用说明" }] } }], scoreIds: [] });
  const canWrite = h.deps.canWriteChannel;
  h.deps.canWriteChannel = async (...args) => {
    const allowed = await canWrite(...args);
    if (h.calls.permissions.length > 1) enabled = false;
    return allowed;
  };
  await h.service.trigger(50);
  assert.deepEqual(h.calls.send, []);
});

test("revoked membership, disabled configuration and inactive characters suppress late model replies", async () => {
  const cases = [
    (h: ReturnType<typeof createHarness>) => h.setAllowed(false),
    (h: ReturnType<typeof createHarness>) => { h.actor.character!.enabled = false; },
    (h: ReturnType<typeof createHarness>) => { h.actor.status = "inactive"; },
    (h: ReturnType<typeof createHarness>) => { h.actor.character = null; },
    (h: ReturnType<typeof createHarness>) => { h.actor.id = 3; }
  ];
  for (const mutate of cases) {
    const h = createHarness();
    h.setOnComplete(() => mutate(h));
    await h.service.trigger(50);
    assert.equal(h.calls.complete, 1);
    assert.deepEqual(h.calls.send, []);
  }
});

test("disabled settings, missing credentials and already stopped exchanges skip generation", async () => {
  const cases = [
    (h: ReturnType<typeof createHarness>) => { h.settings.enabled = false; },
    (h: ReturnType<typeof createHarness>) => h.setApiKey(""),
    (h: ReturnType<typeof createHarness>) => h.setStopped(true)
  ];
  for (const mutate of cases) {
    const h = createHarness(); mutate(h);
    await h.service.trigger(50);
    assert.equal(h.calls.complete, 0);
    assert.deepEqual(h.calls.send, []);
  }
});


test("a role's PASS response stays silent in private chat", async () => {
  const h = createHarness();
  h.deps.complete = async () => " [PASS] ";
  await h.service.trigger(h.message.id);
  assert.equal(h.calls.send.length, 0);
});
