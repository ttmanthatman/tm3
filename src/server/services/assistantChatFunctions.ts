import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ASSISTANT_FEATURES, isAssistantFeatureId } from "../../shared/assistantTools.js";
import { lookupBibleReference, searchBibleText } from "../bible/lookup.js";
import { plainTextFromHtml } from "../textUtils.js";
import type { AssistantToolContext, AssistantToolRegistry } from "./assistantTools.js";

const querySchema = z.object({ query: z.string().trim().max(200).default("") }).strict();
const queryInput = { query: "搜索文字（可留空）" };

/** All data reads use a fixed service adapter and immutable conversation scope. */
export function registerAssistantChatFunctions(registry: AssistantToolRegistry, deps: {
  prisma: PrismaClient;
  searchMusic(input: { query: string; category: "all" | "tracks" | "scores"; offset: number }, context: AssistantToolContext): Promise<unknown>;
  friendPrograms(): Promise<unknown>;
}) {
  registry.register({
    name: "discover_functions", description: "搜索当前聊天室的全部可调用功能；新注册功能会自动出现在这里", kind: "read", input: queryInput, schema: querySchema,
    execute: async ({ query }) => ({ data: registry.list().filter(tool => `${tool.name} ${tool.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) })
  });
  registry.register({
    name: "open_feature", description: "把聊天室功能入口卡片交给用户，由用户点击打开和操作。包括读经、图书、歌曲、歌谱、良友、聊天搜索、收藏、代祷、恩典、故事、手写、接龙、讲道、成员、频道和使用说明", kind: "present",
    input: { feature: ASSISTANT_FEATURES.map(feature => ({ id: feature.id, label: feature.label, description: feature.description })) },
    schema: z.object({ feature: z.custom<typeof ASSISTANT_FEATURES[number]["id"]>(isAssistantFeatureId) }).strict(),
    execute: async ({ feature }) => {
      const definition = ASSISTANT_FEATURES.find(item => item.id === feature)!;
      return { data: { presented: true, feature, message: "入口已准备好；等待用户点击，不代表用户已操作" },
        messages: [{ content: `打开${definition.label}`, payload: { assistantActions: [{ feature, label: `打开${definition.label}` }] } }] };
    }
  });
  registry.register({
    name: "read_scripture", description: "读取真实的本地圣经经文；reference 是出处，如约翰福音3:16", kind: "read", input: { reference: "经文出处" },
    schema: z.object({ reference: z.string().trim().min(1).max(120) }).strict(),
    execute: async ({ reference }) => ({ data: lookupBibleReference(reference) })
  });
  registry.register({
    name: "search_scripture", description: "按原文关键字搜索本地圣经，返回前20项", kind: "read", input: queryInput, schema: querySchema,
    execute: async ({ query }) => ({ data: searchBibleText(query, 0, 20) })
  });
  registry.register({
    name: "search_music", description: "实时查找公共曲库的歌曲、歌词、背景和曲谱；依据真实资源回答和分享", kind: "read", input: { ...queryInput, category: ["all", "tracks", "scores"], offset: "从0开始的偏移量" },
    schema: z.object({ query: z.string().trim().max(200).default(""), category: z.enum(["all", "tracks", "scores"]).default("all"), offset: z.number().int().nonnegative().max(10000).default(0) }).strict(),
    execute: async (input, context) => ({ data: await deps.searchMusic(input, context) })
  });
  registry.register({
    name: "search_books", description: "搜索公共图书目录，返回书名、作者和图书入口；不读取个人阅读进度或笔记", kind: "read", input: queryInput, schema: querySchema,
    execute: async ({ query }) => ({ data: await deps.prisma.book.findMany({
      where: query ? { OR: [{ title: { contains: query } }, { author: { contains: query } }] } : {},
      select: { id: true, title: true, author: true, language: true }, orderBy: { id: "desc" }, take: 20
    }) })
  });
  registry.register({
    name: "search_current_channel", description: "只查找本次提问所在频道的消息，不会跨频道读取私聊或收藏", kind: "read", input: queryInput, schema: querySchema,
    execute: async ({ query }, context) => {
      const rows = await deps.prisma.message.findMany({
        where: { channelId: context.channelId, id: { lte: context.triggerMessageId }, type: { in: ["text", "prayer", "grace", "chain"] }, ...(query ? { content: { contains: query } } : {}) },
        select: { id: true, content: true, type: true, createdAt: true, sender: { select: { displayName: true } } },
        orderBy: { id: "desc" }, take: 20
      });
      return { data: rows.map(row => ({ id: row.id, type: row.type, sender: row.sender.displayName, text: plainTextFromHtml(row.content, 1500), at: row.createdAt.toISOString() })) };
    }
  });
  registry.register({
    name: "list_friend_programs", description: "读取当前良友节目单；收听、分类和下载入口使用 open_feature(friend)", kind: "read", input: {}, schema: z.object({}).strict(),
    execute: async () => ({ data: await deps.friendPrograms() })
  });
}
