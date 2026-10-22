import { plainTextFromHtml } from "../textUtils.js";

const resourceName = /赞美诗|诗歌|歌曲|(?:这|那|一|几)首歌|歌谱|曲谱|谱子|简谱|五线谱|钢琴谱|吉他谱|合唱谱|伴奏谱|经文/;
const requestPrefix = /^(?:我(?:们)?(?:想(?:要)?|要|需要)(?:听|看|读|找|查|一|些|几|关于|有关|赞美诗|诗歌|歌曲|歌谱|曲谱|谱子|经文)|(?:(?:请|麻烦)(?:你)?(?:帮(?:我|我们))?|帮(?:我|我们))?(?:推荐|寻找|查找|找|查|发(?:送)?|播放|提供|读)|(?:请|麻烦)?(?:你)?给(?:我|我们))/;
const topicQuery = /^(?:关于|有关).+(?:的)?(?:赞美诗|诗歌|歌曲|歌谱|曲谱|谱子|简谱|五线谱|钢琴谱|吉他谱|合唱谱|伴奏谱|经文)$/;
const scoreQuery = /^.{1,100}的(?:歌谱|曲谱|谱子|简谱|五线谱|钢琴谱|吉他谱|合唱谱|伴奏谱)$/;
const scoreStatement = /^(?:这|那)(?:是|个|份|首)|^(?:我|我们|他|她|他们|大家)(?:喜欢|喜爱|分享|上传|收藏|保存|看过|听过)|(?:上传|分享|发过|提到|收藏|保存|看过|听过)的(?:歌谱|曲谱|谱子|简谱|五线谱|钢琴谱|吉他谱|合唱谱|伴奏谱)$/;

/** Only a complete command ends a conversation; quoted examples and questions do not. */
export function virtualAssistantStopCommand(content: string | null | undefined, username: string, displayName?: string | null) {
  let text = plainTextFromHtml(content, 4000).trim();
  const names = [...new Set([username, displayName?.trim()].filter((name): name is string => !!name))];
  let addressed = false;
  for (const name of names.sort((a, b) => b.length - a.length)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const prefix = new RegExp(`^@?\\s*${escaped}(?=[\\s，,：:]|安静|闭嘴|你去|去|$)[\\s，,：:]*`, "i");
    if (!prefix.test(text)) continue;
    text = text.replace(prefix, "");
    addressed = true;
    break;
  }
  const command = text.replace(/[\s。.!！]+$/g, "").replace(/^(?:请|麻烦你?)\s*/, "");
  return { stop: /^(?:安静(?:一点)?|闭嘴|(?:你)?去(?:买酱油|跑步|睡觉)(?:吧)?)(?:吧)?$/.test(command), addressed };
}

function isResourceRequest(sentence: string) {
  if (!resourceName.test(sentence)) return false;
  if (requestPrefix.test(sentence) || topicQuery.test(sentence)) return true;
  // A short song-title + score noun is a lookup, while announcements about an
  // uploaded/shared score remain ordinary conversation.
  return scoreQuery.test(sentence) && !scoreStatement.test(sentence);
}

/** Explicit mentions stay direct; question/request triggers remain controlled by the caller's setting. */
export function questionAssistantDirectActivation(content?: string | null, displayName?: string | null): "strong" | "direct" | null {
  const text = plainTextFromHtml(content, 4000);
  if (!text) return null;
  if (/@\s*ai_slmm\b/i.test(text)) return "direct";
  const name = String(displayName || "").trim();
  if (name && name !== "ai_slmm") {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`@\\s*${escapedName}`).test(text) || text.includes(name)) return "direct";
  }
  if (/[?？]/.test(text)) return "strong";
  const sentences = text
    .split(/[。.!！?？；;\n\r]+/)
    .map((sentence) => sentence.replace(/[，,、：:\s"'“”‘’（）()[\]{}]+$/g, "").trim())
    .filter(Boolean);
  return sentences.some((sentence) => /(吗|嘛|为啥|为什么)$/.test(sentence) || isResourceRequest(sentence)) ? "strong" : null;
}

export function questionAssistantActivationAnchor<T extends { content: string | null; createdAt: Date }>(
  rowsNewestFirst: T[], now: Date, settings: { displayName?: string; questionTriggerEnabled?: boolean; activationDurationMinutes: number }
) {
  const cutoff = now.getTime() - settings.activationDurationMinutes * 60_000;
  for (const row of rowsNewestFirst) {
    if (row.createdAt.getTime() < cutoff) return null;
    if (virtualAssistantStopCommand(row.content, "ai_slmm", settings.displayName).stop) return null;
    const mode = questionAssistantDirectActivation(row.content, settings.displayName);
    if (mode === "direct" || (mode === "strong" && settings.questionTriggerEnabled !== false)) return row;
  }
  return null;
}
