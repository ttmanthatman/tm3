import type { IncomingHttpHeaders } from "node:http";

function firstHeader(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw || "")
    .split(",")[0]
    .trim();
}

function localHost(host: string) {
  const hostname = host.replace(/:\d+$/, "").toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

export function normalizePushOrigin(value?: string | null) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.origin;
  } catch {
    return "";
  }
}

export function pushOriginFromHeaders(headers: IncomingHttpHeaders) {
  const origin = normalizePushOrigin(firstHeader(headers.origin));
  if (origin) return origin;

  const host = firstHeader(headers["x-forwarded-host"]) || firstHeader(headers.host);
  if (!host) return "";

  const forwardedProto = firstHeader(headers["x-forwarded-proto"]).toLowerCase();
  const proto = forwardedProto === "http" || forwardedProto === "https" ? forwardedProto : localHost(host) ? "http" : "https";
  return normalizePushOrigin(`${proto}://${host}`);
}
