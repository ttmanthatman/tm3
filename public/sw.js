const SW_URL = new URL(self.location.href || self.location.origin);
const APP_VERSION = SW_URL.searchParams.get("v") || "dev";
const APP_CACHE_PREFIX = "team-chat-app-";
const APP_CACHE = `${APP_CACHE_PREFIX}${APP_VERSION}`;
const CONTENT_CACHE_PREFIX = "team-chat-content-";
const PUBLIC_CONTENT_CACHE = `${CONTENT_CACHE_PREFIX}public`;
const CORE = [
  "/",
  "/manifest.json",
  "/images/icon-192.svg",
  "/images/icon-512.svg",
  "/images/icon-192.png",
  "/images/icon-512.png",
  "/images/icon-maskable-512.png",
  "/images/apple-touch-icon.png",
  "/images/favicon-32.png"
];

function tokenFromRequest(request) {
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token");
  if (queryToken) return queryToken;
  const authorization = request.headers.get("authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
}

function jwtSessionId(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return "";
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const decoded = JSON.parse(atob(normalized));
    return String(decoded.sessionId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
  } catch {
    return "";
  }
}

function contentCacheName(request) {
  const pathname = new URL(request.url).pathname;
  if (/^\/(avatars|backgrounds)\//.test(pathname) || /^\/api\/parallax\//.test(pathname)) return PUBLIC_CONTENT_CACHE;
  const sessionId = jwtSessionId(tokenFromRequest(request));
  return sessionId ? `${CONTENT_CACHE_PREFIX}${sessionId}` : "";
}

function normalizedContentKey(request) {
  const url = new URL(request.url);
  url.searchParams.delete("token");
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.delete("range");
  headers.delete("if-none-match");
  headers.delete("if-modified-since");
  return new Request(url.href, { method: "GET", headers });
}

function fullContentRequest(request, cached) {
  const headers = new Headers(request.headers);
  headers.delete("range");
  if (cached?.headers.get("etag")) headers.set("If-None-Match", cached.headers.get("etag"));
  else if (cached?.headers.get("last-modified")) headers.set("If-Modified-Since", cached.headers.get("last-modified"));
  return new Request(request.url, { method: "GET", headers, credentials: request.credentials, mode: request.mode, redirect: request.redirect });
}

function isCacheableContent(url) {
  return /^\/(avatars|backgrounds)\//.test(url.pathname)
    || /^\/api\/parallax\/[^/]+\/[^/]+$/.test(url.pathname)
    || /^\/api\/music\/tracks\/\d+\/(stream|score\/)/.test(url.pathname)
    || /^\/api\/files\/\d+/.test(url.pathname)
    || /^\/api\/channels\/\d+\/pinned\/files\//.test(url.pathname)
    || /^\/api\/bible\/(lookup|chapter|catalog|search)$/.test(url.pathname);
}

async function updateContentCache(request, cache, key, cached) {
  try {
    const response = await fetch(fullContentRequest(request, cached));
    if (response.status === 304) return cached;
    if (response.ok && response.status === 200) await cache.put(key, response.clone());
    return response;
  } catch {
    return cached;
  }
}

async function rangeResponse(cached, rangeHeader) {
  const blob = await cached.blob();
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader || "");
  if (!match) return cached;
  const suffix = !match[1] && match[2] ? Number(match[2]) : 0;
  const start = suffix > 0 ? Math.max(0, blob.size - suffix) : match[1] ? Number(match[1]) : 0;
  const end = suffix > 0 ? blob.size - 1 : match[2] ? Math.min(Number(match[2]), blob.size - 1) : blob.size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= blob.size) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${blob.size}` } });
  }
  const headers = new Headers();
  for (const name of ["content-type", "content-disposition", "etag", "last-modified", "cache-control"]) {
    const value = cached.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Range", `bytes ${start}-${end}/${blob.size}`);
  headers.set("Content-Length", String(end - start + 1));
  return new Response(blob.slice(start, end + 1, blob.type), { status: 206, headers });
}

async function contentResponse(event) {
  const request = event.request;
  const cacheName = contentCacheName(request);
  if (!cacheName) return fetch(request);
  const cache = await caches.open(cacheName);
  const key = normalizedContentKey(request);
  const cached = await cache.match(key);
  const range = request.headers.get("range");
  if (cached) {
    event.waitUntil(updateContentCache(request, cache, key, cached));
    return range ? rangeResponse(cached, range) : cached;
  }
  if (range) {
    event.waitUntil(updateContentCache(request, cache, key, null));
    return fetch(request);
  }
  const response = await fetch(request);
  if (response.ok && response.status === 200) event.waitUntil(cache.put(key, response.clone()));
  return response;
}

async function appResponse(event) {
  const request = event.request;
  const cache = await caches.open(APP_CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request).then((response) => {
    if (response.ok) return cache.put(request, response.clone()).then(() => response);
    return response;
  }).catch(() => null);
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  const response = await refresh;
  if (response) return response;
  if (request.mode === "navigate") return (await cache.match("/")) || Response.error();
  return Response.error();
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(APP_CACHE_PREFIX) && key !== APP_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "CACHE_RESOURCE" && typeof data.url === "string") {
    const request = new Request(new URL(data.url, self.location.origin).href, { credentials: "same-origin" });
    const cacheName = contentCacheName(request);
    if (!cacheName) return;
    event.waitUntil(caches.open(cacheName).then(async (cache) => {
      const key = normalizedContentKey(request);
      const cached = await cache.match(key);
      await updateContentCache(request, cache, key, cached);
    }));
  }
  if (data.type === "CLEAR_PRIVATE_CACHE" && typeof data.token === "string") {
    const sessionId = jwtSessionId(data.token);
    if (sessionId) event.waitUntil(caches.delete(`${CONTENT_CACHE_PREFIX}${sessionId}`));
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/socket.io/") || url.pathname === "/api/version") return;
  if (isCacheableContent(url)) {
    event.respondWith(contentResponse(event));
    return;
  }
  if (url.pathname.startsWith("/api/")) return;
  event.respondWith(appResponse(event));
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text() || "新消息" };
  }
  const title = payload.title || "Team Chat";
  const options = {
    body: payload.body || "你有一条新通知",
    icon: "/images/icon-192.png",
    badge: "/images/icon-192.png",
    tag: payload.tag || "team-chat",
    renotify: true,
    data: { url: payload.url || "/", channelId: payload.channelId || null }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      if (new URL(client.url).origin === self.location.origin) {
        client.navigate(targetUrl);
        return client.focus();
      }
    }
    return self.clients.openWindow(targetUrl);
  }));
});
