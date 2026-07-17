const DIRECT_CHAT_NAME_LIMIT = 80;
const DIRECT_CHAT_SUGGESTION_COUNT = 7;

function cleanName(value: unknown) {
  return String(value || "")
    .replace(/^[\s\d.、)）-]+/, "")
    .replace(/^["'“‘《【]|["'”’》】]$/g, "")
    .trim()
    .slice(0, DIRECT_CHAT_NAME_LIMIT);
}

function shortMemberLabel(memberNames: string[]) {
  const names = memberNames.map((name) => cleanName(name)).filter(Boolean);
  if (!names.length) return "我们";
  if (names.length === 1) return names[0].slice(0, 8);
  return `${names[0].slice(0, 5)}和${names[1].slice(0, 5)}`;
}

export function fallbackDirectChatNames(memberNames: string[]) {
  const label = shortMemberLabel(memberNames);
  const candidates = [
    `${label}的小宇宙`,
    "快乐碰头会",
    "脑洞联络站",
    "今日份同盟",
    "不散场俱乐部",
    "灵感交换所",
    "悄悄话补给站"
  ];
  return [...new Set(candidates.map(cleanName).filter(Boolean))].slice(0, DIRECT_CHAT_SUGGESTION_COUNT);
}

export function parseDirectChatNameSuggestions(raw: string, memberNames: string[]) {
  const fallback = fallbackDirectChatNames(memberNames);
  let parsed: unknown = null;
  const normalized = String(raw || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    parsed = JSON.parse(normalized);
  } catch {
    parsed = normalized.split(/\r?\n/);
  }
  const source = Array.isArray(parsed) ? parsed : [];
  const suggestions = [...new Set([...source, ...fallback].map(cleanName).filter(Boolean))];
  return suggestions.slice(0, DIRECT_CHAT_SUGGESTION_COUNT);
}

export function isAutomaticDirectChatName(name: string) {
  return /^私聊[：:]/.test(String(name || "").trim());
}
