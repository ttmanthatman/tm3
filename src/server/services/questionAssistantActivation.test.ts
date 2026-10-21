import assert from "node:assert/strict";
import test from "node:test";
import { questionAssistantDirectActivation } from "./questionAssistantActivation.js";

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
