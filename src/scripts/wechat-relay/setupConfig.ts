import crypto from "node:crypto";

const TOKEN_PATTERN = /^[A-Za-z0-9._~+/=-]+$/;
const MANAGED_KEYS = ["RELAY_BASE_URL", "RELAY_AGENT_TOKEN", "RELAY_DATABASE_PATH"] as const;

export interface RelaySetupInput {
  connectionText?: string;
  baseUrl?: string;
  token?: string;
}

export interface RelaySetupConnection {
  baseUrl: string;
  token: string;
  databasePath: string;
}

function unquote(value: string) {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith("\"") && trimmed.endsWith("\""))
    || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseRelayEnvironment(text: string) {
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match) values.set(match[1], unquote(match[2]));
  }
  return values;
}

export function normalizeRelaySetupBaseUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("请输入聊天室地址");

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("聊天室地址格式不正确");
  }
  if (url.protocol !== "https:") throw new Error("聊天室地址必须使用 HTTPS");
  if (url.username || url.password) throw new Error("聊天室地址不能包含用户名或密码");
  if (url.search || url.hash) throw new Error("聊天室地址不能包含查询参数或 # 片段");

  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

export function validateRelaySetupToken(value: string) {
  const token = value.trim();
  if (token.length < 24 || token.length > 256 || !TOKEN_PATTERN.test(token)) {
    throw new Error("令牌应为 24–256 位，仅可包含字母、数字和 . _ ~ + / = -");
  }
  return token;
}

export function relayDatabasePath(baseUrl: string) {
  const url = new URL(baseUrl);
  const site = url.hostname.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "") || "site";
  const fingerprint = crypto.createHash("sha256").update(baseUrl).digest("hex").slice(0, 12);
  return `/var/lib/wechat-relay/relay-${site}-${fingerprint}.sqlite`;
}

export function resolveRelaySetupInput(input: RelaySetupInput, existingEnvironment = ""): RelaySetupConnection {
  const pasted = input.connectionText?.trim() || "";
  const pastedValues = parseRelayEnvironment(pasted);
  const existingValues = parseRelayEnvironment(existingEnvironment);
  const pastedToken = pasted && !pasted.includes("=") ? pasted : "";
  const baseUrl = normalizeRelaySetupBaseUrl(
    pastedValues.get("RELAY_BASE_URL") || input.baseUrl || existingValues.get("RELAY_BASE_URL") || ""
  );
  const token = validateRelaySetupToken(
    pastedValues.get("RELAY_AGENT_TOKEN") || pastedToken || input.token || ""
  );
  return { baseUrl, token, databasePath: relayDatabasePath(baseUrl) };
}

export function updateRelayEnvironment(existingEnvironment: string, connection: RelaySetupConnection) {
  const replacements: Record<(typeof MANAGED_KEYS)[number], string> = {
    RELAY_BASE_URL: connection.baseUrl,
    RELAY_AGENT_TOKEN: connection.token,
    RELAY_DATABASE_PATH: connection.databasePath
  };
  const seen = new Set<string>();
  const output: string[] = [];

  for (const line of existingEnvironment.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/);
    const key = match?.[1] as (typeof MANAGED_KEYS)[number] | undefined;
    if (!key || !MANAGED_KEYS.includes(key)) {
      output.push(line);
      continue;
    }
    if (!seen.has(key)) {
      output.push(`${key}=${replacements[key]}`);
      seen.add(key);
    }
  }

  if (output.at(-1) === "") output.pop();
  for (const key of MANAGED_KEYS) {
    if (!seen.has(key)) output.push(`${key}=${replacements[key]}`);
  }
  return `${output.join("\n")}\n`;
}
