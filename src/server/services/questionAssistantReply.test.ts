import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { createAssistantToolRegistry } from "./assistantTools.js";
import { listenPlaylistPayload } from "../../shared/listenPlaylist.js";
import {
  generateQuestionAssistantReply, QUESTION_ASSISTANT_MEDIA_PROTOCOL, requestQuestionAssistantCompletion,
  type QuestionAssistantChatMessage, type QuestionAssistantSearch
} from "./questionAssistantReply.js";

const search = (query = "平安", category = "all", offset = 0) => JSON.stringify({ kind: "search_music", query, category, offset });
const reply = (text = "找到以下内容", items: unknown[] = [], scoreIds: number[] = []) => JSON.stringify({ kind: "reply", text, items, scoreIds });
const track = (trackId = 7) => ({ kind: "track", trackId });
const scripture = (reference = "约翰福音3:16") => ({ kind: "scripture", reference });
type CompletionStep = string | ((messages: QuestionAssistantChatMessage[]) => string | Promise<string>);

function harness(steps: CompletionStep[]) {
  const prompts: QuestionAssistantChatMessage[][] = [];
  const searches: QuestionAssistantSearch[] = [];
  const resolvedTrackIds: number[] = [];
  const checkedScoreIds: number[] = [];
  const liveTracks = new Map([[7, { id: 7, title: "真正的歌名" }], [8, { id: 8, title: "第二首诗歌" }]]);
  const readableScores = new Set([30, 31, 32]);
  const catalog = {
    tracks: [{ id: 7, title: "查询时的歌名", scores: [{ id: 30 }] }, { id: 8, title: "第二首诗歌", scores: [] }],
    scores: [{ id: 31 }, { id: 32 }], hasMore: false, nextOffset: null as number | null
  };
  const deps = {
    prompt: "请用温柔的口吻回答，保留管理员独特的人设与经文解释要求。旧格式要求：用 /听 和 @@ 发歌。",
    context: "我想听关于平安的赞美诗，也想看一段经文和曲谱。",
    complete: async (messages: QuestionAssistantChatMessage[]) => {
      const index = prompts.length;
      prompts.push(structuredClone(messages));
      const step = steps[index];
      assert.notEqual(step, undefined, `unexpected completion call ${index + 1}`);
      return typeof step === "function" ? step(messages) : step;
    },
    searchMusic: async (input: QuestionAssistantSearch) => { searches.push(structuredClone(input)); return catalog; },
    resolveTrack: async (id: number) => { resolvedTrackIds.push(id); return liveTracks.get(id) ?? null; },
    canShareScore: async (id: number) => { checkedScoreIds.push(id); return readableScores.has(id); }
  };
  return { deps, prompts, searches, resolvedTrackIds, checkedScoreIds, liveTracks, readableScores, catalog };
}

test("registered tools are discovered, invoked with immutable scope, and produce application-owned feature cards", async () => {
  const context = { accountId: 1, channelId: 2, triggerMessageId: 3, assistantActorId: 4 };
  let calls = 0;
  const registry = createAssistantToolRegistry(async value => { assert.deepEqual(value, context); return true; });
  registry.register({ name: "open_feature", description: "打开功能", kind: "present", input: { feature: "help" }, schema: z.object({ feature: z.literal("help") }).strict(),
    execute: async () => { calls++; return { data: { presented: true }, messages: [{ content: "使用说明", payload: { assistantActions: [{ feature: "help", label: "打开使用说明" }] } }] }; } });
  const call = JSON.stringify({ kind: "call_tool", name: "open_feature", arguments: { feature: "help" } });
  const h = harness([call, call, reply("请点击下面的入口")]);
  const result = await generateQuestionAssistantReply({ ...h.deps, tools: { registry, context, maxCalls: 1 } });
  assert.equal(calls, 1, "a second invocation must not bypass the configured call budget");
  assert.match(h.prompts[0].map(item => item.content).join("\n"), /open_feature/);
  assert.deepEqual(result.messages[0].payload, { assistantActions: [{ feature: "help", label: "打开使用说明" }] });
  assert.equal(result.messages.at(-1)?.content, "请点击下面的入口");
});

test("legacy and registered searches share one budget and the same live authorization", async () => {
  const context = { accountId: 1, channelId: 2, triggerMessageId: 3, assistantActorId: 4 };
  const modern = JSON.stringify({ kind: "call_tool", name: "search_music", arguments: { query: "平安", category: "all", offset: 0 } });
  for (const steps of [[modern, search(), reply("已完成")], [search(), modern, reply("已完成")]]) {
    const h = harness(steps);
    let calls = 0;
    const registry = createAssistantToolRegistry(async () => true);
    registry.register({ name: "search_music", description: "查曲库", kind: "read", input: {}, schema: z.object({ query: z.string(), category: z.string(), offset: z.number() }).strict(),
      execute: async () => { calls++; return { data: h.catalog }; } });
    await generateQuestionAssistantReply({ ...h.deps, tools: { registry, context, maxCalls: 1 } });
    assert.equal(calls, 1);
    assert.equal(h.searches.length, 0, "the legacy adapter cannot bypass registry authorization");
  }
  const h = harness([search(), reply("功能不可用")]);
  const registry = createAssistantToolRegistry(async () => false);
  registry.register({ name: "search_music", description: "查曲库", kind: "read", input: {}, schema: z.object({}).passthrough(),
    execute: async () => { throw new Error("must not execute"); } });
  await generateQuestionAssistantReply({ ...h.deps, tools: { registry, context, maxCalls: 2 } });
  assert.equal(h.searches.length, 0);
});

test("disabling functions during generation prevents final resource lookup and new calls", async () => {
  const h = harness([search(), reply("播放", [track(7)], [30]), search(), reply("功能已关闭")]);
  let enabled = true;
  const searchMusic = h.deps.searchMusic;
  h.deps.searchMusic = async input => { const result = await searchMusic(input); enabled = false; return result; };
  const result = await generateQuestionAssistantReply({ ...h.deps, canUseResources: async () => enabled });
  assert.equal(h.searches.length, 1);
  assert.deepEqual(h.resolvedTrackIds, []);
  assert.deepEqual(h.checkedScoreIds, []);
  assert.equal(result.messages[0].content, "功能已关闭");
});

test("disabling function calls also blocks the legacy resource-search protocol", async () => {
  const h = harness([search(), reply("功能调用已关闭")]);
  const result = await generateQuestionAssistantReply({ ...h.deps, allowResources: false });
  assert.deepEqual(h.searches, []);
  assert.equal(result.messages[0].content, "功能调用已关闭");
});

test("ordinary answers preserve the custom prompt and Markdown without querying music", async () => {
  const h = harness([reply("## 信靠\n\n在祷告中交托自己的忧虑。")]);
  const result = await generateQuestionAssistantReply(h.deps);
  assert.deepEqual(result, {
    messages: [{ content: "## 信靠\n\n在祷告中交托自己的忧虑。", payload: { contentFormat: "markdown" } }], scoreIds: []
  });
  assert.deepEqual(h.prompts[0], [
    { role: "system", content: h.deps.prompt },
    { role: "system", content: QUESTION_ASSISTANT_MEDIA_PROTOCOL },
    { role: "user", content: h.deps.context }
  ]);
  assert.match(QUESTION_ASSISTANT_MEDIA_PROTOCOL, /最多4次查询/);
  assert.match(QUESTION_ASSISTANT_MEDIA_PROTOCOL, /人设、回答风格和内容要求仍然保留/);
  assert.equal(h.searches.length, 0);
  assert.equal(h.resolvedTrackIds.length, 0);
  assert.equal(h.checkedScoreIds.length, 0);
});

test("the saved base system prompt replaces the default while preserving persona and context", async () => {
  const h = harness([reply("按已保存的指令回答。")]);
  await generateQuestionAssistantReply({ ...h.deps, systemPrompt: "管理员修改后的底层提示" });
  assert.deepEqual(h.prompts[0], [
    { role: "system", content: h.deps.prompt },
    { role: "system", content: "管理员修改后的底层提示" },
    { role: "user", content: h.deps.context }
  ]);
});

test("legacy prose and JSON code fences remain readable during provider format transitions", async () => {
  for (const answer of ["**愿你平安**", "```json\n" + reply("**愿你平安**") + "\n``` "]) {
    const h = harness([answer]);
    const result = await generateQuestionAssistantReply(h.deps);
    assert.equal(result.messages[0].content, "**愿你平安**");
    assert.equal(h.searches.length, 0);
  }
});

test("searched songs become separate playable mentions using current library titles in model order", async () => {
  const h = harness([search(), reply("愿这些诗歌陪伴你。", [track(8), track(7)])]);
  h.liveTracks.set(7, { id: 7, title: "恩典 & 爱 <合唱>" });
  const result = await generateQuestionAssistantReply(h.deps);
  assert.deepEqual(result.messages, [
    { content: "愿这些诗歌陪伴你。", payload: { contentFormat: "markdown" } },
    { content: "@@第二首诗歌", payload: { musicTrackId: 8, musicTrackTitle: "第二首诗歌" } },
    { content: "@@恩典 &amp; 爱 &lt;合唱&gt;", payload: { musicTrackId: 7, musicTrackTitle: "恩典 & 爱 <合唱>" } }
  ]);
  assert.deepEqual(h.resolvedTrackIds, [8, 7]);
  assert.equal(h.searches[0].query, "平安");
  assert.equal(h.searches[0].category, "all");
  assert.equal(h.searches[0].offset, 0);
  assert.match(h.prompts[1].at(-1)!.content, /当前曲库查询结果/);
  assert.match(h.prompts[1].at(-1)!.content, /查询时的歌名/);
  assert.doesNotMatch(JSON.stringify(result), /查询时的歌名|\.mp3/);
});

test("mixed scriptures and songs expand references into a single ordered listen card", async () => {
  const h = harness([search(), reply("一起听这些内容。", [
    scripture("诗篇23:1; 约翰福音3:16"), track(7), scripture("马太福音6:33")
  ])]);
  const result = await generateQuestionAssistantReply(h.deps);
  assert.equal(result.messages.length, 2);
  const playlist = listenPlaylistPayload(result.messages[1].payload);
  assert.ok(playlist);
  assert.deepEqual(playlist.items.map((item) => item.kind === "track" ? item.trackId : item.bookCode), ["PSA", "JHN", 7, "MAT"]);
  const first = playlist.items[0];
  assert.ok(first.kind === "scripture");
  assert.equal(first.startChapter, 23);
  assert.equal(first.startVerse, 1);
  assert.ok(playlist.translation);
  assert.match(result.messages[1].content, /一起听：/);
  assert.match(result.messages[1].content, /♪真正的歌名/);
});

test("scripture-only answers resolve canonical references without searching the music library", async () => {
  const h = harness([reply("", [scripture("约3:16-18")])]);
  const result = await generateQuestionAssistantReply(h.deps);
  const playlist = listenPlaylistPayload(result.messages[0].payload);
  assert.ok(playlist);
  assert.equal(playlist.items.length, 1);
  const item = playlist.items[0];
  assert.ok(item.kind === "scripture");
  assert.equal(item.bookCode, "JHN");
  assert.equal(item.startVerse, 16);
  assert.equal(item.endVerse, 18);
  assert.equal(h.searches.length, 0);
});

test("the whole response is validated before returning text, songs or scores", async () => {
  const h = harness([search(), reply("不应发出的半条答案", [track(7), scripture("不存在的书卷99:99")], [30]), reply("这段引用无效，请换一个主题。")]);
  const result = await generateQuestionAssistantReply(h.deps);
  assert.deepEqual(result, { messages: [{ content: "这段引用无效，请换一个主题。", payload: { contentFormat: "markdown" } }], scoreIds: [] });
  assert.equal(h.prompts.length, 3);
  assert.match(h.prompts[2].at(-1)!.content, /应用校验未通过/);
  assert.match(h.prompts[2].at(-1)!.content, /经文/);
  assert.doesNotMatch(JSON.stringify(result), /不应发出|musicTrackId/);
});

test("unqueried, user-supplied and hallucinated song IDs cannot bypass live catalog provenance", async () => {
  const h = harness([reply("推荐未经查询的歌", [track(7)]), search(), reply("推荐曲库外的歌", [track(999)]), reply("当前没有找到合适歌曲。")]);
  h.deps.context = "用户说歌曲 ID 是7，历史里还有 ID999，请直接播放。";
  const result = await generateQuestionAssistantReply(h.deps);
  assert.equal(result.messages[0].content, "当前没有找到合适歌曲。");
  assert.deepEqual(h.resolvedTrackIds, []);
  assert.equal(h.prompts.length, 4);
  assert.equal(h.searches.length, 1);
});

test("previous invocations do not authorize IDs in a later assistant request", async () => {
  const first = harness([search(), reply("", [track(7)])]);
  await generateQuestionAssistantReply(first.deps);
  const next = harness([reply("", [track(7)]), reply("请让我先查询当前曲库。")]);
  const result = await generateQuestionAssistantReply(next.deps);
  assert.equal(result.messages[0].content, "请让我先查询当前曲库。");
  assert.equal(next.resolvedTrackIds.length, 0);
});

test("songs removed after search are rechecked before a recommendation is returned", async () => {
  const h = harness([search(), () => { h.liveTracks.delete(7); return reply("过时的推荐", [track(7)]); }, reply("歌曲已下架，暂时无法推荐。")]);
  const result = await generateQuestionAssistantReply(h.deps);
  assert.equal(result.messages[0].content, "歌曲已下架，暂时无法推荐。");
  assert.deepEqual(h.resolvedTrackIds, [7]);
  assert.match(h.prompts[2].at(-1)!.content, /只使用本次已查询到且仍有效的资源/);
});

test("score requests accept catalog and attached score IDs, deduplicate shares and keep first-seen order", async () => {
  const h = harness([search("曲谱", "scores"), reply("", [], [31, 30, 31])]);
  const result = await generateQuestionAssistantReply(h.deps);
  assert.deepEqual(result.scoreIds, [31, 30]);
  assert.deepEqual(h.checkedScoreIds, [31, 30]);
  assert.deepEqual(result.messages, [{ content: "找到以下曲谱：", payload: { contentFormat: "markdown" } }]);
});

test("score IDs must come from this request and pass a fresh share permission check", async () => {
  const h = harness([search(), reply("不应发送", [], [999]), reply("不应发送", [], [30]), reply("没有可分享的曲谱。")]);
  h.readableScores.delete(30);
  const result = await generateQuestionAssistantReply(h.deps);
  assert.deepEqual(result.scoreIds, []);
  assert.equal(result.messages[0].content, "没有可分享的曲谱。");
  assert.deepEqual(h.checkedScoreIds, [30]);
  assert.match(h.prompts[3].at(-1)!.content, /曲谱 ID 无效/);
});

test("query pagination and category changes are passed through and remember IDs across searches", async () => {
  const h = harness([search("平安", "tracks"), search("安慰", "scores", 20), reply("", [track(7)], [31])]);
  h.catalog.hasMore = true;
  h.catalog.nextOffset = 20;
  const result = await generateQuestionAssistantReply(h.deps);
  assert.deepEqual(h.searches.map(({ query, category, offset }) => ({ query, category, offset })), [
    { query: "平安", category: "tracks", offset: 0 }, { query: "安慰", category: "scores", offset: 20 }
  ]);
  assert.equal(result.messages[0].payload.musicTrackId, 7);
  assert.deepEqual(result.scoreIds, [31]);
  assert.match(h.prompts[1].at(-1)!.content, /"hasMore":true/);
});

test("the fifth search is refused and the model can finish with the four collected results", async () => {
  const h = harness([search("一"), search("二"), search("三"), search("四"), search("五"), reply("现有结果已经足够。", [track(7)])]);
  const result = await generateQuestionAssistantReply(h.deps);
  assert.equal(h.searches.length, 4);
  assert.equal(h.prompts.length, 6);
  assert.match(h.prompts[5].at(-1)!.content, /查询已达4次上限/);
  assert.equal(result.messages[1].payload.musicTrackId, 7);
});

test("malformed output permits two repairs and rejects a third failed response", async () => {
  const repaired = harness(["{broken", JSON.stringify({ kind: "reply", text: "", items: [{ kind: "video", id: 1 }] }), reply("已修正。")]);
  assert.equal((await generateQuestionAssistantReply(repaired.deps)).messages[0].content, "已修正。");
  assert.match(repaired.prompts[1].at(-1)!.content, /应用校验未通过：JSON 格式/);
  const rejected = harness(["{broken", "{}", reply("")]);
  await assert.rejects(() => generateQuestionAssistantReply(rejected.deps), /AI 回复格式或推荐内容校验失败/);
  assert.equal(rejected.prompts.length, 3);
});

test("unknown fields, oversized replies, too many items and too many scores are repaired", async () => {
  for (const invalid of [
    JSON.stringify({ kind: "reply", text: "无效", url: "https://untrusted.invalid/file.mp3" }),
    reply("过".repeat(5001)), reply("", Array.from({ length: 21 }, () => scripture())), reply("", [], [30, 31, 32, 30]),
    JSON.stringify({ kind: "search_music", query: "多".repeat(201) }),
    JSON.stringify({ kind: "search_music", query: "平安", category: "private", offset: -1 })
  ]) {
    const h = harness([invalid, reply("请换个更具体的主题。")]);
    assert.equal((await generateQuestionAssistantReply(h.deps)).messages[0].content, "请换个更具体的主题。");
    assert.equal(h.searches.length, 0);
    assert.equal(h.prompts.length, 2);
  }
});

test("expanded multi-passage references still respect the assistant's twenty-item limit", async () => {
  const oversized = Array.from({ length: 20 }, () => scripture("诗篇23:1; 约翰福音3:16"));
  const h = harness([reply("不应发送四十段经文", oversized), reply("请缩小经文范围。")]);
  const result = await generateQuestionAssistantReply(h.deps);
  assert.equal(result.messages[0].content, "请缩小经文范围。");
  assert.equal(h.prompts.length, 2);
});

test("completion transport failures propagate instead of returning a fabricated empty answer", async () => {
  const h = harness([async () => { throw new Error("provider unavailable"); }]);
  await assert.rejects(() => generateQuestionAssistantReply(h.deps), /provider unavailable/);
  assert.equal(h.prompts.length, 1);
});

test("HTTP completion sends the configured endpoint, model, persona, thinking flag and abort signal", async () => {
  for (const thinkingEnabled of [true, false, undefined]) {
    const messages: QuestionAssistantChatMessage[] = [{ role: "system", content: "保留人设" }, { role: "user", content: "问题" }];
    const requests: Array<{ input: string; init: RequestInit | undefined }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({ input: String(input), init });
      return new Response(JSON.stringify({ choices: [{ message: { content: "  回答内容  " } }] }), { status: 200 });
    };
    const result = await requestQuestionAssistantCompletion({ baseUrl: "https://provider.invalid/v1///", model: "configured-model", thinkingEnabled }, "private-test-key", messages, fetchImpl);
    assert.equal(result, "回答内容");
    assert.equal(requests[0].input, "https://provider.invalid/v1/chat/completions");
    assert.equal(requests[0].init?.method, "POST");
    assert.deepEqual(requests[0].init?.headers, { "Content-Type": "application/json", Authorization: "Bearer private-test-key" });
    assert.deepEqual(JSON.parse(String(requests[0].init?.body)), { model: "configured-model", messages, thinking: { type: thinkingEnabled ? "enabled" : "disabled" }, stream: false });
    assert.ok(requests[0].init?.signal instanceof AbortSignal);
    assert.equal(requests[0].init?.signal?.aborted, false);
  }
});

test("HTTP completion rejects provider errors and invalid or empty success content", async () => {
  const settings = { baseUrl: "https://provider.invalid/v1", model: "model" };
  for (const body of [JSON.stringify({ error: { message: "do not leak provider-private-detail" } }), "upstream temporarily unavailable"]) {
    await assert.rejects(() => requestQuestionAssistantCompletion(settings, "private-test-key", [], async () => new Response(body, { status: 503 })), /AI HTTP 503/);
  }
  for (const body of [{}, { choices: [] }, { choices: [{ message: { content: "  " } }] }, { choices: [{ message: { content: "x".repeat(30001) } }] }]) {
    await assert.rejects(() => requestQuestionAssistantCompletion(settings, "key", [], async () => new Response(JSON.stringify(body), { status: 200 })));
  }
  await assert.rejects(() => requestQuestionAssistantCompletion(settings, "key", [], async () => new Response("{broken", { status: 200 })), SyntaxError);
  await assert.rejects(() => requestQuestionAssistantCompletion(settings, "key", [], async () => { throw new Error("network unavailable"); }), /network unavailable/);
});

test("HTTP failures cancel an unread streaming response body", async () => {
  let cancelled = false;
  const stream = new ReadableStream({ cancel: () => { cancelled = true; } });
  await assert.rejects(() => requestQuestionAssistantCompletion(
    { baseUrl: "https://provider.invalid", model: "model" }, "key", [],
    async () => new Response(stream, { status: 503 })
  ), /AI HTTP 503/);
  assert.equal(cancelled, true);
});

test("HTTP completion aborts after forty-five seconds and clears a successful request's timer", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  context.after(() => context.mock.timers.reset());
  let timeoutSignal: AbortSignal | null = null;
  const blockedFetch: typeof fetch = async (_input, init) => {
    const signal = init?.signal;
    assert.ok(signal);
    timeoutSignal = signal;
    return new Promise<Response>((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
  };
  const pending = requestQuestionAssistantCompletion({ baseUrl: "https://provider.invalid", model: "model" }, "key", [], blockedFetch);
  context.mock.timers.tick(44_999);
  assert.equal((timeoutSignal as AbortSignal | null)?.aborted, false);
  context.mock.timers.tick(1);
  await assert.rejects(pending, { name: "AbortError" });

  let completedSignal: AbortSignal | null = null;
  await requestQuestionAssistantCompletion({ baseUrl: "https://provider.invalid", model: "model" }, "key", [], async (_input, init) => {
    completedSignal = init?.signal || null;
    return new Response(JSON.stringify({ choices: [{ message: { content: "完成" } }] }));
  });
  context.mock.timers.tick(45_000);
  assert.equal((completedSignal as AbortSignal | null)?.aborted, false);
});
