import jwt from "jsonwebtoken";
import type { FastifyRequest } from "fastify";

// Cache-stamped or range-chunked GET routes stay behind their normal auth
// checks but do not consume the shared per-minute rate budget — one audio
// stream alone is dozens of range requests, and a fresh deploy makes every
// device re-fetch its immutable assets at once.
const EXEMPT_GET_PREFIXES = [
  "/assets/",
  "/avatars/",
  "/backgrounds/",
  "/api/files/",
  "/api/friend/media",
  "/api/parallax/"
];
const EXEMPT_GET_PATTERNS = [
  /^\/api\/music\/tracks\/\d+\/stream$/,
  /^\/api\/music\/scores\/\d+\/pages\/\d+$/,
  /^\/api\/channels\/\d+\/pinned\/files\/[^/]+$/
];

export function isRateLimitExempt(method: string, url: string): boolean {
  const path = url.split("?", 1)[0];
  // Socket.IO long-polling mixes GET and POST; the handshake is not abuse surface.
  if (path.startsWith("/socket.io/")) return true;
  if (method !== "GET" && method !== "HEAD") return false;
  if (EXEMPT_GET_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  return EXEMPT_GET_PATTERNS.some((pattern) => pattern.test(path));
}

// Authenticated requests count against the account, not the IP, so a whole
// gathering behind one venue NAT no longer shares a single 240/minute budget.
// A syntactically valid but revoked token still gets the account key — the
// request itself is rejected later by requireAuth, so nothing is smuggled in.
export function createRateLimitKeyGenerator(secret: string): (request: FastifyRequest) => string {
  return (request) => {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (token) {
      try {
        const decoded = jwt.verify(token, secret) as { accountId?: unknown };
        if (typeof decoded.accountId === "number") return `account:${decoded.accountId}`;
      } catch {
        // fall through to the IP bucket
      }
    }
    return `ip:${request.ip}`;
  };
}
