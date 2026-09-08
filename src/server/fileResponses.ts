import fs from "node:fs";
import path from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";
import { fileResponsePolicy } from "./filePolicy.js";

export function applyFileResponseHeaders(reply: FastifyReply, name: string, forceDownload: boolean) {
  const policy = fileResponsePolicy(name, forceDownload);
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Cross-Origin-Resource-Policy", "same-origin");
  reply.header("Content-Type", policy.contentType);
  reply.header("Content-Disposition", `${policy.disposition}; filename*=UTF-8''${encodeURIComponent(path.basename(name))}`);
  if (policy.sandbox) reply.header("Content-Security-Policy", "sandbox; default-src 'none'");
  return policy;
}

export function applyFileValidation(request: FastifyRequest, reply: FastifyReply, stat: fs.Stats) {
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  reply.header("ETag", etag);
  reply.header("Last-Modified", stat.mtime.toUTCString());
  // Served files are content-addressed (UUID filenames, one upload per name),
  // so long-lived immutable caching is safe and avoids a revalidation round
  // trip per avatar/image on every page view.
  reply.header("Cache-Control", "private, max-age=31536000, immutable");
  const noneMatch = String(request.headers["if-none-match"] || "");
  const modifiedSince = Date.parse(String(request.headers["if-modified-since"] || ""));
  return noneMatch === etag || (!noneMatch && Number.isFinite(modifiedSince) && stat.mtimeMs <= modifiedSince + 999);
}

export function applyJsonValidation(request: FastifyRequest, reply: FastifyReply, etag: string) {
  reply.header("ETag", etag);
  reply.header("Cache-Control", "private, no-cache");
  return String(request.headers["if-none-match"] || "") === etag;
}
