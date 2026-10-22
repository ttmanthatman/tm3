import assert from "node:assert/strict";
import test from "node:test";
import { questionAssistantActivationAnchor, questionAssistantDirectActivation, virtualAssistantStopCommand } from "./questionAssistantActivation.js";

test("activation uses its own duration, stop boundaries and new explicit reactivation", () => {
  const now = new Date("2026-10-22T12:00:00Z");
  const row = (content: string, minutesAgo: number) => ({ content, createdAt: new Date(now.getTime() - minutesAgo * 60_000) });
  const settings = { activationDurationMinutes: 3, displayName: "所罗没门", questionTriggerEnabled: true };
  const question = row("为什么？", 2);
  assert.equal(questionAssistantActivationAnchor([question], now, settings), question);
  assert.equal(questionAssistantActivationAnchor([row("为什么？", 4)], now, settings), null);
  assert.equal(questionAssistantActivationAnchor([row("谢谢", 0), row("闭嘴", 1), question], now, settings), null);
  const next = row("@所罗没门 再来回答", 0);
  assert.equal(questionAssistantActivationAnchor([next, row("闭嘴", 1), question], now, settings), next);
  assert.equal(questionAssistantActivationAnchor([question], now, { ...settings, questionTriggerEnabled: false }), null);
  assert.equal(questionAssistantActivationAnchor([next], now, { ...settings, questionTriggerEnabled: false }), next);
});

test("complete stop commands accept mentions and polite endings without matching ordinary discussion", () => {
  for (const content of ["@所罗没门 安静", "闭嘴", "你去买酱油吧", "你去跑步吧", "你去睡觉吧", "<p>@ai_slmm 请安静！</p>", "所罗没门，闭嘴。"])
    assert.equal(virtualAssistantStopCommand(content, "ai_slmm", "所罗没门").stop, true, content);
  for (const content of ["为什么要安静？", "他说你去睡觉吧", "不要闭嘴", "@其他人 安静", "安静的经文", "“闭嘴”是什么含义？"])
    assert.equal(virtualAssistantStopCommand(content, "ai_slmm", "所罗没门").stop, false, content);
  assert.deepEqual(virtualAssistantStopCommand("@小+助手 安静", "ai_slmm", "小+助手"), { stop: true, addressed: true });
});

test("explicit assistant mentions and configured nicknames retain direct activation", () => {
  for (const text of ["@ai_slmm 我想听歌", "@ AI_SLMM", "<b>@ai_slmm</b> 关于安慰的经文", "@ai_slmm 你好吗？"]) {
    assert.equal(questionAssistantDirectActivation(text), "direct", text);
  }
  for (const text of ["@小+助手 请回答", "请小+助手帮忙"]) {
    assert.equal(questionAssistantDirectActivation(text, " 小+助手 "), "direct", text);
  }
  assert.equal(questionAssistantDirectActivation("ai_slmm"), null);
  assert.equal(questionAssistantDirectActivation("@ai_slmm_other"), null);
});

test("question punctuation and question endings retain strong activation", () => {
  for (const text of ["这是为什么？", "可以吗", "大家怎么看?", "今天有聚会。一起去嘛！", "先说一件事\n为什么", "可以吗，"]) {
    assert.equal(questionAssistantDirectActivation(text), "strong", text);
  }
  for (const text of [undefined, null, "", "  <b></b>  ", "明天见", "为什么这样做很重要"]) {
    assert.equal(questionAssistantDirectActivation(text), null, String(text));
  }
});

test("a final visible space overrides mentions, question marks and resource requests", () => {
  for (const content of ["@ai_slmm 为什么？ ", "@所罗没门 你好 ", "为什么？ ", "奇异恩典的曲谱 ", "<p>@ai_slmm 为什么？&nbsp;</p>"])
    assert.equal(questionAssistantDirectActivation(content, "所罗没门"), null, content);
  assert.equal(virtualAssistantStopCommand("闭嘴 ", "ai_slmm").stop, false);
});

test("suppressed messages never become a later weak activation anchor", () => {
  const now = new Date();
  const settings = { activationDurationMinutes: 3 };
  const trimmed = { content: "@ai_slmm 为什么？", createdAt: now, payload: { aiActivationSuppressed: true } };
  const historic = { content: "为什么？ ", createdAt: now };
  assert.equal(questionAssistantActivationAnchor([trimmed, historic], now, settings), null);
  const older = { content: "之前的问题？", createdAt: new Date(now.getTime() - 60_000) };
  assert.equal(questionAssistantActivationAnchor([trimmed, historic, older], now, settings), older);
});

test("explicit music, scripture and score requests activate without a mention or question mark", () => {
  for (const text of [
    "我想听关于平安的赞美诗", "关于安慰的经文", "奇异恩典的歌谱", "奇异恩典的谱子",
    "请推荐几首关于盼望的歌曲", "帮我找关于恩典的经文", "请给我奇异恩典的曲谱",
    "麻烦你推荐一首赞美诗", "我需要关于信靠的经文", "给我发奇异恩典的简谱",
    "有关平安的诗歌", "我想要奇异恩典的钢琴谱", "你好。关于安慰的经文", "<p>我想听关于平安的赞美诗</p>"
  ]) {
    assert.equal(questionAssistantDirectActivation(text), "strong", text);
  }
});

test("ordinary statements about songs, shared scripture and uploaded scores stay quiet", () => {
  for (const text of [
    "我喜欢这首歌", "这是昨天上传的歌谱", "今天分享一段经文", "今天分享一段经文。愿大家平安。",
    "这是我喜欢的经文", "我听过很多关于平安的赞美诗", "昨天上传的歌谱", "我收藏的曲谱",
    "关于安慰的经文很好", "请大家今天分享一段经文", "我想把昨天的歌谱上传", "播放记录已经保存",
    "大家保存的伴奏谱"
  ]) {
    assert.equal(questionAssistantDirectActivation(text), null, text);
  }
});

test("direct mentions take priority over the strong resource-request classification", () => {
  assert.equal(questionAssistantDirectActivation("@ai_slmm 奇异恩典的谱子"), "direct");
  assert.equal(questionAssistantDirectActivation("小助手，我想听关于平安的赞美诗", "小助手"), "direct");
});
