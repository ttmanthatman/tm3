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

export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {})
    },
    cache: "no-store"
  });
  const type = response.headers.get("content-type") || "";
  const payload = type.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const message = typeof payload === "object" && payload ? (payload as { message?: string }).message : "";
    throw new Error(message || `HTTP ${response.status}`);
  }
  return payload as T;
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
