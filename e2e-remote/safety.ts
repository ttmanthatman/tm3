export interface RemoteE2EProfile {
  hostname: string;
  username: string;
  channel: string;
}

// 精确允许的目标列表：新增远程测试站必须在此登记完整 profile（主机、专用账号、
// 专用频道）。环境变量只能从这里选择 profile，不能把任意传入 URL 变成可信目标；
// https 页面目标与 wss 实时目标必须始终是同一主机。
export const REMOTE_E2E_PROFILES = {
  demo: { hostname: "demo.xiaogushi.us", username: "remote_e2e", channel: "远程冒烟测试" },
  azure: { hostname: "azure-liao.xiaogushi.us", username: "remote_e2e", channel: "远程冒烟测试" }
} as const satisfies Record<string, RemoteE2EProfile>;

export type RemoteE2EProfileName = keyof typeof REMOTE_E2E_PROFILES;

export const REMOTE_E2E_PROFILE_NAMES: readonly RemoteE2EProfileName[] = Object.keys(REMOTE_E2E_PROFILES);

export interface RemoteE2EEnvironment {
  baseURL: string;
  username: string;
  password: string;
  channel: string;
}

function fail(message: string): never {
  throw new Error(`Remote E2E safety check failed: ${message}`);
}

function approvedProfile(env: NodeJS.ProcessEnv): { name: RemoteE2EProfileName } & RemoteE2EProfile {
  const raw = env.REMOTE_E2E_PROFILE;
  if (!raw) fail(`REMOTE_E2E_PROFILE is required; approved profiles: ${REMOTE_E2E_PROFILE_NAMES.join(", ")}`);
  const name = raw as RemoteE2EProfileName;
  const profile = REMOTE_E2E_PROFILES[name];
  if (!profile) fail(`REMOTE_E2E_PROFILE "${raw}" is not approved; approved profiles: ${REMOTE_E2E_PROFILE_NAMES.join(", ")}`);
  return { name, ...profile };
}

export function remoteE2EEnvironment(env: NodeJS.ProcessEnv = process.env): RemoteE2EEnvironment {
  const profile = approvedProfile(env);
  const baseURL = env.REMOTE_E2E_BASE_URL;
  const username = env.REMOTE_E2E_USERNAME;
  const password = env.REMOTE_E2E_PASSWORD;
  const channel = env.REMOTE_E2E_CHANNEL;
  if (!baseURL || !username || !password || !channel) fail("required remote test environment is missing");

  let parsed: URL;
  try {
    parsed = new URL(baseURL);
  } catch {
    fail("base URL is invalid");
  }
  if (parsed.username || parsed.password) fail("base URL must not embed credentials");
  if (parsed.port) fail("base URL must use the default HTTPS port");
  if (parsed.protocol !== "https:" || parsed.hostname !== profile.hostname) fail("base URL does not match the selected approved profile target");
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) fail("base URL must be a bare origin");
  if (username !== profile.username) fail("username is not the dedicated remote test account");
  if (channel !== profile.channel) fail("channel is not the dedicated remote test channel");
  if (password.length < 24) fail("password does not meet the dedicated-account strength requirement");
  return { baseURL: parsed.origin, username, password, channel };
}

export function isApprovedRemoteRequest(url: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const profile = REMOTE_E2E_PROFILES[env.REMOTE_E2E_PROFILE as RemoteE2EProfileName];
  if (!profile) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password || parsed.port) return false;
  return (parsed.protocol === "https:" || parsed.protocol === "wss:") && parsed.hostname === profile.hostname;
}
