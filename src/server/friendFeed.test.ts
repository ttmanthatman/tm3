/// <reference types="node" />

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createFriendFeedService,
  isAllowedFriendMediaUrl,
  nextFriendFeedRefreshAt,
  parseFriendApiCategories,
  parseFriendApiTracks
} from "./friendFeed.js";

const API_BASE = "https://x.lydt.work/api";

const SAMPLE_TODAY = {
  data: [
    {
      id: "195414",
      description: "人生导师讲堂：面对情感剥削者（1）",
      alias: "ct260723",
      play_at: "2026-07-23 00:00:00",
      path: "/ly/audio/2026/ct/ct260723.mp3",
      link: "https://stlb.work/storage/ly/audio/2026/ct/ct260723.mp3",
      program: { id: "125", name: "关心.在线", code: "ct" }
    },
    {
      id: "194742",
      description: "约书亚记（11）",
      alias: "tb260723",
      play_at: "2026-07-23 00:00:00",
      path: "/ly/audio/2026/tb/tb260723.mp3",
      program: { id: "30", name: "穿越圣经", code: "tb" }
    },
    {
      id: "000001",
      description: "缺少音频路径",
      path: "",
      program: { id: "1", name: "无效", code: "xx" }
    }
  ]
};

const SAMPLE_CATEGORIES = {
  data: [
    {
      id: "6",
      name: "生活智慧",
      type: "ly",
      programs: [
        { id: "2", name: "书香园地", alias: "bc", description: "陪你读好书" },
        { id: "5", name: "不孤单地球", alias: "wc", description: "因为有你，我们不孤单" }
      ]
    },
    { id: "9", name: "空分类", type: "ly", programs: [] },
    {
      id: "10",
      name: "含无效别名",
      type: "ly",
      programs: [{ id: "99", name: "无效", alias: "bad alias!" }]
    }
  ]
};

const SAMPLE_SERIES = {
  data: [
    {
      id: "195414",
      description: "人生导师讲堂：面对情感剥削者（1）",
      alias: "ct260723",
      play_at: "2026-07-23 00:00:00",
      path: "/ly/audio/2026/ct/ct260723.mp3",
      program: { id: "125", name: "关心.在线", code: "ct" }
    }
  ]
};

function apiRoutes(overrides: Record<string, () => Response> = {}) {
  return {
    [`${API_BASE}/today`]: () => Response.json(SAMPLE_TODAY),
    [`${API_BASE}/categories`]: () => Response.json(SAMPLE_CATEGORIES),
    [`${API_BASE}/program/ct`]: () => Response.json(SAMPLE_SERIES),
    ...overrides
  } as Record<string, () => Response>;
}

function stubFetch(routes: Record<string, () => Response>, calls?: string[]) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls?.push(url);
    const handler = routes[url];
    if (!handler) throw new Error(`unexpected fetch ${url}`);
    return handler();
  }) as typeof fetch;
}

test("parseFriendApiTracks 解析 today 接口并映射字段", () => {
  const programs = parseFriendApiTracks(SAMPLE_TODAY);
  assert.equal(programs.length, 2);
  assert.deepEqual(programs[0], {
    id: "195414",
    seriesId: "125",
    seriesTitle: "关心.在线",
    title: "人生导师讲堂：面对情感剥削者（1）",
    date: "2026-07-23",
    audioUrl: "https://txly2.net/ly/audio/2026/ct/ct260723.mp3",
    imageUrl: "https://d3ml8yyp1h3hy5.cloudfront.net/ly/image/cover/ct.jpg"
  });
});

test("parseFriendApiTracks 对无数据或损坏内容返回空数组", () => {
  assert.deepEqual(parseFriendApiTracks(null), []);
  assert.deepEqual(parseFriendApiTracks({ data: "broken" }), []);
  assert.deepEqual(parseFriendApiTracks({ data: [{ id: "1", path: "/other/x.mp3" }] }), []);
});

test("parseFriendApiCategories 解析分类并过滤空分类与无效别名", () => {
  const categories = parseFriendApiCategories(SAMPLE_CATEGORIES);
  assert.equal(categories.length, 1);
  assert.equal(categories[0].title, "生活智慧");
  assert.deepEqual(categories[0].series[0], {
    id: "2",
    alias: "bc",
    title: "书香园地",
    description: "陪你读好书"
  });
  assert.deepEqual(parseFriendApiCategories({ data: null }), []);
});

test("isAllowedFriendMediaUrl 只允许白名单主机的音频与封面路径", () => {
  assert.equal(isAllowedFriendMediaUrl("https://txly2.net/ly/audio/2022/hp/hp220311.mp3"), true);
  assert.equal(isAllowedFriendMediaUrl("https://txly2.net/images/program_banners/hp.png"), true);
  assert.equal(isAllowedFriendMediaUrl("https://d3ml8yyp1h3hy5.cloudfront.net/ly/image/cover/ct.jpg"), true);
  assert.equal(isAllowedFriendMediaUrl("https://d3ml8yyp1h3hy5.cloudfront.net/ly/audio/x.mp3"), false);
  assert.equal(isAllowedFriendMediaUrl("http://txly2.net/ly/audio/x.mp3"), false);
  assert.equal(isAllowedFriendMediaUrl("https://evil.example.com/ly/audio/x.mp3"), false);
  assert.equal(isAllowedFriendMediaUrl("https://txly2.net/other/x.mp3"), false);
  assert.equal(isAllowedFriendMediaUrl("https://user:pass@txly2.net/ly/audio/x.mp3"), false);
  assert.equal(isAllowedFriendMediaUrl("not-a-url"), false);
});

test("nextFriendFeedRefreshAt 返回本地 7 点或 19 点的下一次刷新时刻", () => {
  const at = (hour: number, minute = 0) => new Date(2026, 6, 23, hour, minute).getTime();
  assert.equal(nextFriendFeedRefreshAt(at(6, 59)), at(7));
  assert.equal(nextFriendFeedRefreshAt(at(12)), at(19));
  assert.equal(nextFriendFeedRefreshAt(at(19)), at(7) + 24 * 60 * 60 * 1000);
  assert.equal(nextFriendFeedRefreshAt(at(23, 30)), at(7) + 24 * 60 * 60 * 1000);
});

test("getPrograms 抓取 today 接口并包装为本站代理地址", async (context) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "friend-feed-"));
  context.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const calls: string[] = [];
  const service = createFriendFeedService({ fetchImpl: stubFetch(apiRoutes(), calls), apiBase: API_BASE, cacheDir: scratch });
  const programs = await service.getPrograms();
  assert.equal(programs.length, 2);
  assert.equal(programs[0].id, "195414");
  assert.equal(programs[0].seriesTitle, "关心.在线");
  assert.equal(programs[0].audioUrl, `/api/friend/media?u=${encodeURIComponent("https://txly2.net/ly/audio/2026/ct/ct260723.mp3")}`);
  assert.equal(programs[0].imageUrl, `/api/friend/media?u=${encodeURIComponent("https://d3ml8yyp1h3hy5.cloudfront.net/ly/image/cover/ct.jpg")}`);
  assert.deepEqual(calls, [`${API_BASE}/today`]);
});

test("getCategories 抓取分类接口并包装封面代理地址", async (context) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "friend-feed-"));
  context.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const service = createFriendFeedService({ fetchImpl: stubFetch(apiRoutes()), apiBase: API_BASE, cacheDir: scratch });
  const categories = await service.getCategories();
  assert.equal(categories.length, 1);
  assert.equal(categories[0].series.length, 2);
  assert.equal(categories[0].series[0].alias, "bc");
  assert.equal(
    categories[0].series[0].imageUrl,
    `/api/friend/media?u=${encodeURIComponent("https://d3ml8yyp1h3hy5.cloudfront.net/ly/image/cover/bc.jpg")}`
  );
});

test("getSeriesPrograms 抓取系列节目并校验别名", async (context) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "friend-feed-"));
  context.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const calls: string[] = [];
  const service = createFriendFeedService({ fetchImpl: stubFetch(apiRoutes(), calls), apiBase: API_BASE, cacheDir: scratch });
  const programs = await service.getSeriesPrograms("CT");
  assert.equal(programs.length, 1);
  assert.equal(programs[0].id, "195414");
  assert.deepEqual(calls, [`${API_BASE}/program/ct`]);
  await assert.rejects(() => service.getSeriesPrograms("../etc"), /不支持的节目系列/);
  assert.equal(calls.length, 1, "非法别名不应发起请求");
});

test("getPrograms 在 TTL 内使用缓存，过期后重新抓取，失败时回退旧缓存", async (context) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "friend-feed-"));
  context.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  let tick = 0;
  let broken = false;
  let fetchCount = 0;
  const routes = apiRoutes();
  const fetchStub = (async (input: RequestInfo | URL) => {
    fetchCount += 1;
    if (broken) throw new Error("network down");
    const handler = routes[String(input)];
    if (!handler) throw new Error(`unexpected fetch ${String(input)}`);
    return handler();
  }) as typeof fetch;
  const service = createFriendFeedService({ fetchImpl: fetchStub, apiBase: API_BASE, cacheDir: scratch, ttlMs: 1000, now: () => tick });

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
  const service = createFriendFeedService({ fetchImpl: failingFetch, apiBase: API_BASE, cacheDir: scratch });
  await assert.rejects(() => service.getPrograms(), /network down/);
});

test("未指定 ttlMs 时缓存有效至下一个 7 点或 19 点边界", async (context) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "friend-feed-"));
  context.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  let tick = new Date(2026, 6, 23, 8, 0).getTime();
  let fetchCount = 0;
  const routes = apiRoutes();
  const fetchStub = (async (input: RequestInfo | URL) => {
    fetchCount += 1;
    const handler = routes[String(input)];
    if (!handler) throw new Error(`unexpected fetch ${String(input)}`);
    return handler();
  }) as typeof fetch;
  const service = createFriendFeedService({ fetchImpl: fetchStub, apiBase: API_BASE, cacheDir: scratch, now: () => tick });

  await service.getPrograms();
  assert.equal(fetchCount, 1);
  tick = new Date(2026, 6, 23, 18, 59).getTime();
  await service.getPrograms();
  assert.equal(fetchCount, 1, "边界前应使用缓存");
  tick = new Date(2026, 6, 23, 19, 1).getTime();
  await service.getPrograms();
  assert.equal(fetchCount, 2, "越过 19 点边界后应重新抓取");
});

test("refreshAll 强制重取今日节目与分类并清空系列缓存", async (context) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "friend-feed-"));
  context.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const calls: string[] = [];
  const service = createFriendFeedService({ fetchImpl: stubFetch(apiRoutes(), calls), apiBase: API_BASE, cacheDir: scratch, ttlMs: 60_000 });
  await service.getPrograms();
  await service.getCategories();
  await service.getSeriesPrograms("ct");
  assert.equal(calls.length, 3);

  await service.refreshAll();
  assert.deepEqual(calls.slice(3).sort(), [`${API_BASE}/categories`, `${API_BASE}/today`]);

  calls.length = 0;
  await service.getSeriesPrograms("ct");
  assert.deepEqual(calls, [`${API_BASE}/program/ct`], "系列缓存应已被清空并重新抓取");
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
