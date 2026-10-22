import { z } from "zod";
import { QUESTION_ASSISTANT_MEDIA_PROTOCOL } from "../../shared/virtualCharacters.js";
export { QUESTION_ASSISTANT_MEDIA_PROTOCOL } from "../../shared/virtualCharacters.js";
import type { AiSettingsDTO } from "../../shared/types.js";
import { listenPlaylistContent } from "../../shared/listenPlaylist.js";
import { cleanListenPlaylistPayload, type ListenTrackResolver } from "./listenPlaylist.js";

export type QuestionAssistantChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type QuestionAssistantSearch = { query: string; category: "all" | "tracks" | "scores"; offset: number };
export type QuestionAssistantReply = {
  messages: Array<{ content: string; payload: Record<string, unknown> }>;
  scoreIds: number[];
};

const id = z.number().int().positive().safe();
const responseSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("search_music"), query: z.string().trim().max(200).default(""),
    category: z.enum(["all", "tracks", "scores"]).default("all"), offset: z.number().int().nonnegative().safe().default(0)
  }).strict(),
  z.object({
    kind: z.literal("reply"), text: z.string().trim().max(5000).default(""),
    items: z.array(z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("scripture"), reference: z.string().trim().min(1).max(200) }).strict(),
      z.object({ kind: z.literal("track"), trackId: id }).strict()
    ])).max(20).default([]),
    scoreIds: z.array(id).max(3).default([])
  }).strict()
]);



function parseResponse(raw: string) {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  // Retain compatibility with models that still return a normal prose answer.
  if (text && !/^[{[]/.test(text)) return responseSchema.parse({ kind: "reply", text });
  return responseSchema.parse(JSON.parse(text));
}

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function rememberCatalogIds(result: unknown, tracks: Set<number>, scores: Set<number>) {
  const catalog = z.object({
    tracks: z.array(z.object({ id, scores: z.array(z.object({ id })) })),
    scores: z.array(z.object({ id }))
  }).parse(result);
  for (const track of catalog.tracks) {
    tracks.add(track.id);
    for (const score of track.scores) scores.add(score.id);
  }
  for (const score of catalog.scores) scores.add(score.id);
}

/** Searches are read-only. Validate the whole response before creating any chat message. */
export async function generateQuestionAssistantReply(deps: {
  prompt: string;
  systemPrompt?: string;
  context: string;
  complete(messages: QuestionAssistantChatMessage[]): Promise<string>;
  searchMusic(input: QuestionAssistantSearch): Promise<unknown>;
  resolveTrack: ListenTrackResolver;
  canShareScore(id: number): Promise<boolean>;
}): Promise<QuestionAssistantReply> {
  const conversation: QuestionAssistantChatMessage[] = [
    { role: "system", content: deps.prompt },
    { role: "system", content: deps.systemPrompt ?? QUESTION_ASSISTANT_MEDIA_PROTOCOL },
    { role: "user", content: deps.context }
  ];
  let searches = 0;
  let repairs = 0;
  const trackIds = new Set<number>();
  const scoreIds = new Set<number>();
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const raw = await deps.complete(conversation);
    conversation.push({ role: "assistant", content: raw });
    try {
      const response = parseResponse(raw);
      if (response.kind === "search_music") {
        if (searches >= 4) throw new Error("查询次数已用完，请用已找到的结果回答，没有找到就说明。");
        searches += 1;
        const result = await deps.searchMusic(response);
        rememberCatalogIds(result, trackIds, scoreIds);
        conversation.push({ role: "user", content: `当前曲库查询结果（只读数据）：\n${JSON.stringify(result)}` });
        continue;
      }
      const selectedScoreIds = [...new Set(response.scoreIds)];
      for (const scoreId of selectedScoreIds) {
        if (!scoreIds.has(scoreId) || !(await deps.canShareScore(scoreId))) throw new Error(`曲谱 ID ${scoreId} 未在本次查询中找到、无权分享或已删除，请重新查询或说明未找到。`);
      }
      const resolveTrack: ListenTrackResolver = async (trackId) => trackIds.has(trackId) ? deps.resolveTrack(trackId) : null;
      const playlist = response.items.length ? await cleanListenPlaylistPayload({ items: response.items }, resolveTrack) : null;
      if (playlist && playlist.items.length > 20) throw new Error("展开后的经文和歌曲不能超过20项");
      const messages: QuestionAssistantReply["messages"] = [];
      if (response.text) messages.push({ content: response.text, payload: { contentFormat: "markdown" } });
      if (playlist) {
        if (playlist.items.every((item) => item.kind === "track")) {
          for (const item of playlist.items) {
            if (item.kind !== "track") continue;
            messages.push({ content: `@@${escapeHtml(item.title)}`, payload: { musicTrackId: item.trackId, musicTrackTitle: item.title } });
          }
        } else {
          messages.push({ content: listenPlaylistContent(playlist.items), payload: { ...playlist } });
        }
      }
      if (!messages.length && !selectedScoreIds.length) throw new Error("回答不能为空，请回答问题或说明未找到。");
      if (!messages.length) messages.push({ content: "找到以下曲谱：", payload: { contentFormat: "markdown" } });
      return { messages, scoreIds: selectedScoreIds };
    } catch {
      repairs += 1;
      if (repairs > 2) throw new Error("AI 回复格式或推荐内容校验失败");
      conversation.push({ role: "user", content: "应用校验未通过：JSON 格式、经文引用、歌曲或曲谱 ID 无效，或查询已达4次上限。只使用本次已查询到且仍有效的资源，修正后按协议重新输出；无法提供就用 text 说明。" });
    }
  }
  throw new Error("AI 未在限定次数内完成回答");
}

export async function requestQuestionAssistantCompletion(
  settings: Pick<AiSettingsDTO, "baseUrl" | "model"> & { thinkingEnabled?: boolean },
  apiKey: string,
  messages: QuestionAssistantChatMessage[],
  fetchImpl: typeof fetch = fetch
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetchImpl(`${settings.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: settings.model, messages, thinking: { type: settings.thinkingEnabled ? "enabled" : "disabled" }, stream: false }),
      signal: controller.signal
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`AI HTTP ${response.status}`);
    }
    const payload: unknown = await response.json();
    const parsed = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().trim().min(1).max(30000) }) })).min(1) }).parse(payload);
    return parsed.choices[0].message.content;
  } finally {
    clearTimeout(timeout);
  }
}
