import type { AuthResponse } from "@shared/types";
import { friendlyDeviceName } from "@shared/activityLog";
import { APP_VERSION } from "@shared/release";

const TOKEN_KEY = "team-chat-token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  const token = getToken();
  if (token && "serviceWorker" in navigator) {
    navigator.serviceWorker.controller?.postMessage({ type: "CLEAR_PRIVATE_CACHE", token });
  }
  localStorage.removeItem(TOKEN_KEY);
}

export function authHeaders(init?: HeadersInit): HeadersInit {
  return { ...(init || {}), Authorization: `Bearer ${getToken()}` };
}

const API_GET_TIMEOUT_MS = 20_000;
const API_GET_RETRY_DELAY_MS = 400;

function apiHeaders(options: RequestInit): HeadersInit {
  return {
    ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
    ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {})
  };
}

async function fetchForAttempt(url: string, options: RequestInit, withTimeout: boolean): Promise<Response> {
  const headers = apiHeaders(options);
  if (!withTimeout || options.signal) return fetch(url, { ...options, headers, cache: "no-store" });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_GET_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, headers, cache: "no-store", signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted && !options.signal) throw new Error("请求超时，请检查网络后重试");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  // GETs drive startup and revalidation; a stalled request on a weak link
  // used to hang the whole bootstrap until the TCP timeout, so bound it and
  // retry the transport once. Non-GET requests (uploads, mutations) keep
  // their previous behavior.
  const isGet = !options.method || options.method.toUpperCase() === "GET";
  const maxAttempts = isGet ? 2 : 1;
  let lastTransportError: unknown = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, API_GET_RETRY_DELAY_MS));
    let response: Response;
    try {
      response = await fetchForAttempt(url, options, isGet);
    } catch (error) {
      lastTransportError = error;
      continue;
    }
    const type = response.headers.get("content-type") || "";
    const payload = type.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) {
      const message = typeof payload === "object" && payload ? (payload as { message?: string }).message : "";
      throw new Error(message || `HTTP ${response.status}`);
    }
    return payload as T;
  }
  throw lastTransportError instanceof Error ? lastTransportError : new Error("网络请求失败");
}

export async function login(username: string, password: string) {
  const result = await api<{ success: boolean } & AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      username,
      password,
      deviceName: friendlyDeviceName(navigator.platform, navigator.userAgent, navigator.maxTouchPoints),
      appVersion: APP_VERSION
    })
  });
  setToken(result.token);
  return result.account;
}

export async function register(username: string, displayName: string, password: string) {
  const result = await api<{ success: boolean } & AuthResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      username,
      displayName,
      password,
      deviceName: friendlyDeviceName(navigator.platform, navigator.userAgent, navigator.maxTouchPoints),
      appVersion: APP_VERSION
    })
  });
  setToken(result.token);
  return result.account;
}

export async function joinReception(code: string, displayName: string, inviteToken?: string) {
  const result = await api<{ success: boolean } & AuthResponse>("/api/reception/join", {
    method: "POST",
    body: JSON.stringify({
      ...(inviteToken ? { inviteToken } : { code }),
      displayName,
      deviceName: friendlyDeviceName(navigator.platform, navigator.userAgent, navigator.maxTouchPoints),
      appVersion: APP_VERSION
    })
  });
  setToken(result.token);
  return result.account;
}
