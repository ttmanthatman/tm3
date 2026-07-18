export const REMOTE_E2E_HOSTNAME = "demo.xiaogushi.us";
export const REMOTE_E2E_USERNAME = "remote_e2e";
export const REMOTE_E2E_CHANNEL = "远程冒烟测试";

export interface RemoteE2EEnvironment {
  baseURL: string;
  username: string;
  password: string;
  channel: string;
}

function fail(message: string): never {
  throw new Error(`Remote E2E safety check failed: ${message}`);
}

export function remoteE2EEnvironment(env: NodeJS.ProcessEnv = process.env): RemoteE2EEnvironment {
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
  if (parsed.protocol !== "https:" || parsed.hostname !== REMOTE_E2E_HOSTNAME) fail("base URL is not the approved HTTPS test site");
  if (username !== REMOTE_E2E_USERNAME) fail("username is not the dedicated remote test account");
  if (channel !== REMOTE_E2E_CHANNEL) fail("channel is not the dedicated remote test channel");
  if (password.length < 24) fail("password does not meet the dedicated-account strength requirement");
  return { baseURL: parsed.origin, username, password, channel };
}

export function isApprovedRemoteRequest(url: string): boolean {
  const parsed = new URL(url);
  return (parsed.protocol === "https:" || parsed.protocol === "wss:") && parsed.hostname === REMOTE_E2E_HOSTNAME;
}
