import type { BibleTopicDTO } from "../shared/bibleTopics.js";

// 经文主题操作集合：由 useBibleWorkspaceIntegration 提供，经 BibleWorkspace 传入书房首页，
// 打包成单个 prop 避免六个操作函数逐个透传。
export type BibleTopicActions = {
  create: (name: string) => Promise<BibleTopicDTO>;
  rename: (topicId: number, name: string) => Promise<BibleTopicDTO>;
  remove: (topicId: number) => Promise<void>;
  addPassages: (topicId: number, reference: string) => Promise<{ topic: BibleTopicDTO; added: number; duplicates: number }>;
  removePassages: (topicId: number, passageIds: number[]) => Promise<BibleTopicDTO>;
  share: (topicId: number) => Promise<unknown>;
};
