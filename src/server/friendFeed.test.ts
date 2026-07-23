/// <reference types="node" />

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createFriendFeedService,
  extractFriendChunkUrls,
  isAllowedFriendMediaUrl,
  parseFriendPrograms
} from "./friendFeed.js";

const SAMPLE_HTML = `<!DOCTYPE html><html><head>
<script src="/_next/static/chunks/webpack-aaa.js" defer=""></script>
<script src="/_next/static/chunks/857-bbb.js" defer=""></script>
<script src="/_next/static/chunks/pages/%5B...all%5D-ccc.js" defer=""></script>
</head><body><div id="__next"></div></body></html>`;

const SAMPLE_CHUNK = `self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[857],{1:function(){var g={todayItems:[
{series_id:"489",series_title:"\\u661F\\u52A8\\u4E00\\u523B",series_alias:"hp",avatar_sq:"https://txly2.net/images/program_banners/hp_prog_banner_sq.png",sermon_id:"89386",sermon_title:"\\u661F\\u52A8\\u4E00\\u523B-20220311",sermon_notes:"<p>\\u97F3\\u4E50\\u8D70\\u5FC3\\u542C &amp; 更多</p>",sermon_publish_up:"2022-03-11",url:"https://txly2.net/ly/audio/2022/hp/hp220311.mp3",tag_id:"6"},
{series_id:"302",series_title:"\\u89E3\\u7ECF\\u4E0E\\u7814\\u7ECF",series_alias:"mavhe",avatar_sq:"https://txly2.net/images/program_banners/ltsdp_prog_banner_sq.png",sermon_id:"34982",sermon_title:"\\u89E3\\u7ECF\\u4E0E\\u7814\\u7ECF(017)",sermon_notes:'<p><span style="font-size: 12px;">\\u7B2C17\\u8BFE</span></p>',sermon_publish_up:"2022-03-11",url:"https://txly2.net/ly/audio/mavhe/mavhe017.mp3",tag_id:"12"},
{series_id:"1",series_title:"缺音频",sermon_id:"00001",sermon_title:"无地址",sermon_publish_up:"2022-03-11",url:"",tag_id:"1"},
],}}]);`;

function sampleRoutes() {
  return {
    "https://sw1.page/tabs/feed": () => new Response(SAMPLE_HTML, { headers: { "content-type": "text/html" } }),
    "https://sw1.page/_next/static/chunks/pages/%5B...all%5D-ccc.js": () => new Response("var page=1;"),
    "https://sw1.page/_next/static/chunks/857-bbb.js": () => new Response(SAMPLE_CHUNK),
    "https://sw1.page/_next/static/chunks/webpack-aaa.js": () => new Response("var wp=1;")
  } as Record<string, () => Response>;
}

test("extractFriendChunkUrls 收集脚本地址并转为绝对地址", () => {
  const urls = extractFriendChunkUrls(SAMPLE_HTML, "https://sw1.page/tabs/feed");
  assert.deepEqual(urls, [
    "https://sw1.page/_next/static/chunks/webpack-aaa.js",
    "https://sw1.page/_next/static/chunks/857-bbb.js",
    "https://sw1.page/_next/static/chunks/pages/%5B...all%5D-ccc.js"
  ]);
});

test("parseFriendPrograms 解析内嵌 todayItems（含单引号、unicode 转义、缺字段过滤）", () => {
  const programs = parseFriendPrograms(SAMPLE_CHUNK);
  assert.equal(programs.length, 2);
  assert.deepEqual(programs[0], {
    id: "89386",
    seriesId: "489",
    seriesTitle: "星动一刻",
    title: "星动一刻-20220311",
    date: "2022-03-11",
    notes: "音乐走心听 & 更多",
    audioUrl: "https://txly2.net/ly/audio/2022/hp/hp220311.mp3",
    imageUrl: "https://txly2.net/images/program_banners/hp_prog_banner_sq.png"
  });
  assert.equal(programs[1].notes, "第17课");
});

test("parseFriendPrograms 对无数据或损坏内容返回空数组", () => {
  assert.deepEqual(parseFriendPrograms("var x = 1;"), []);
  assert.deepEqual(parseFriendPrograms("todayItems:[{broken"), []);
});

test("isAllowedFriendMediaUrl 只允许 txly2.net 的音频与图片路径", () => {
  assert.equal(isAllowedFriendMediaUrl("https://txly2.net/ly/audio/2022/hp/hp220311.mp3"), true);
  assert.equal(isAllowedFriendMediaUrl("https://txly2.net/images/program_banners/hp.png"), true);
  assert.equal(isAllowedFriendMediaUrl("http://txly2.net/ly/audio/x.mp3"), false);
  assert.equal(isAllowedFriendMediaUrl("https://evil.example.com/ly/audio/x.mp3"), false);
  assert.equal(isAllowedFriendMediaUrl("https://txly2.net/other/x.mp3"), false);
  assert.equal(isAllowedFriendMediaUrl("https://user:pass@txly2.net/ly/audio/x.mp3"), false);
  assert.equal(isAllowedFriendMediaUrl("not-a-url"), false);
});

test("getPrograms 抓取 feed 与 chunk 并包装为本站代理地址", async (context) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "friend-feed-"));
  context.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const calls: string[] = [];
  const routes = sampleRoutes();
  const fetchStub = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const handler = routes[url];
    if (!handler) throw new Error(`unexpected fetch ${url}`);
    return handler();
  }) as typeof fetch;
  const service = createFriendFeedService({ fetchImpl: fetchStub, cacheDir: scratch });
  const programs = await service.getPrograms();
  assert.equal(programs.length, 2);
  assert.equal(programs[0].id, "89386");
  assert.equal(programs[0].seriesTitle, "星动一刻");
  assert.equal(programs[0].audioUrl, `/api/friend/media?u=${encodeURIComponent("https://txly2.net/ly/audio/2022/hp/hp220311.mp3")}`);
  assert.equal(programs[0].imageUrl, `/api/friend/media?u=${encodeURIComponent("https://txly2.net/images/program_banners/hp_prog_banner_sq.png")}`);
  // 页面 chunk 优先解析，命中后不再抓更早的 chunk
  assert.ok(!calls.includes("https://sw1.page/_next/static/chunks/webpack-aaa.js"));
});

test("getPrograms 在 TTL 内使用缓存，过期后重新抓取，失败时回退旧缓存", async (context) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "friend-feed-"));
  context.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  let tick = 0;
  let broken = false;
  let fetchCount = 0;
  const routes = sampleRoutes();
  const fetchStub = (async (input: RequestInfo | URL) => {
    fetchCount += 1;
    if (broken) throw new Error("network down");
    const handler = routes[String(input)];
    if (!handler) throw new Error(`unexpected fetch ${String(input)}`);
    return handler();
  }) as typeof fetch;
  const service = createFriendFeedService({ fetchImpl: fetchStub, cacheDir: scratch, ttlMs: 1000, now: () => tick });

  await service.getPrograms();
  const warmCount = fetchCount;
  await service.getPrograms();
  assert.equal(fetchCount, warmCount, "TTL 内不应重复抓取");

  tick = 2000;
  broken = true;
  const programs = await service.getPrograms();
  assert.equal(programs.length, 2, "刷新失败时应回退旧缓存");
  assert.ok(fetchCount > warmCount, "过期后应尝试重新抓取");
});

test("getPrograms 无缓存且抓取失败时抛出错误", async (context) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "friend-feed-"));
  context.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const failingFetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;
  const service = createFriendFeedService({ fetchImpl: failingFetch, cacheDir: scratch });
  await assert.rejects(() => service.getPrograms(), /network down/);
});

test("storeMediaStream 落盘缓存并可命中读取，字节数不符时不缓存", async (context) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "friend-feed-"));
  context.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const service = createFriendFeedService({ cacheDir: scratch });
  const url = "https://txly2.net/ly/audio/2022/hp/hp220311.mp3";
  const payload = new Uint8Array([1, 2, 3, 4, 5]);
  await service.storeMediaStream(url, "audio/mpeg", payload.byteLength, new Response(payload).body!);
  const cached = service.resolveCachedMedia(url);
  assert.ok(cached);
  assert.equal(cached.size, payload.byteLength);
  assert.equal(cached.contentType, "audio/mpeg");
  assert.deepEqual(new Uint8Array(fs.readFileSync(cached.filePath)), payload);

  const bad = "https://txly2.net/ly/audio/2022/hp/bad.mp3";
  await service.storeMediaStream(bad, "audio/mpeg", 99, new Response(payload).body!);
  assert.equal(service.resolveCachedMedia(bad), null);
});

test("超出容量上限时按最旧缓存淘汰", async (context) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "friend-feed-"));
  context.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  let tick = 0;
  const service = createFriendFeedService({ cacheDir: scratch, maxCacheBytes: 10, now: () => tick });
  const payload = new Uint8Array([1, 2, 3, 4, 5]);
  const first = "https://txly2.net/ly/audio/a.mp3";
  const second = "https://txly2.net/ly/audio/b.mp3";
  const third = "https://txly2.net/ly/audio/c.mp3";
  tick = 1;
  await service.storeMediaStream(first, "audio/mpeg", 5, new Response(payload).body!);
  tick = 2;
  await service.storeMediaStream(second, "audio/mpeg", 5, new Response(payload).body!);
  assert.ok(service.resolveCachedMedia(first));
  tick = 3;
  await service.storeMediaStream(third, "audio/mpeg", 5, new Response(payload).body!);
  assert.equal(service.resolveCachedMedia(first), null, "最旧的缓存应被淘汰");
  assert.ok(service.resolveCachedMedia(second));
  assert.ok(service.resolveCachedMedia(third));
});

test("fetchMediaStream 透传 Range 并回传上游响应头", async (context) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "friend-feed-"));
  context.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  let seenRange: string | null = null;
  const fetchStub = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    seenRange = new Headers(init?.headers).get("range");
    return new Response(new Uint8Array([9, 9, 9]), {
      status: 206,
      headers: {
        "content-type": "audio/mpeg",
        "content-length": "3",
        "content-range": "bytes 0-2/10"
      }
    });
  }) as typeof fetch;
  const service = createFriendFeedService({ fetchImpl: fetchStub, cacheDir: scratch });
  const media = await service.fetchMediaStream("https://txly2.net/ly/audio/x.mp3", "bytes=0-2");
  assert.equal(seenRange, "bytes=0-2");
  assert.equal(media.status, 206);
  assert.equal(media.contentType, "audio/mpeg");
  assert.equal(media.contentLength, 3);
  assert.equal(media.contentRange, "bytes 0-2/10");
  await media.body.cancel();

  await assert.rejects(() => service.fetchMediaStream("https://evil.example.com/ly/audio/x.mp3"), /不支持的媒体地址/);
});
