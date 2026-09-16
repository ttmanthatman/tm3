import assert from "node:assert/strict";
import test from "node:test";
import type { BookDTO } from "../../shared/types";
import {
  IDLE_PRELOAD_BOOK_LIMIT,
  IDLE_PRELOAD_BOOK_MAX_BYTES,
  pickIdlePreloadBooks,
  scheduleIdlePreload
} from "./idlePreload";

function book(id: number, progress: number | null, fileSize = 1024): BookDTO {
  return {
    id,
    title: `书 ${id}`,
    author: "作者",
    language: "zh",
    fileName: `book-${id}.epub`,
    coverName: null,
    fileSize,
    createdAt: "2026-01-01T00:00:00.000Z",
    progress
  };
}

// 同步调度：测试里立即推进空闲队列
const runNow = (callback: () => void) => callback();

test("pickIdlePreloadBooks 只选在读中的书，按 id 倒序并受数量与总量限制", () => {
  const books = [
    book(1, null), // 未读
    book(2, 0), // 未开始
    book(3, 0.5),
    book(4, 1), // 已读完
    book(5, 0.999), // 已读完（>0.995）
    book(6, 0.2),
    book(7, 0.8),
    book(8, 0.1)
  ];
  const picked = pickIdlePreloadBooks(books);
  assert.deepEqual(picked.map((b) => b.id), [8, 7, 6]);
  assert.ok(picked.length <= IDLE_PRELOAD_BOOK_LIMIT);
});

test("pickIdlePreloadBooks 超出总字节预算的书被跳过，但不阻塞后续更小的书", () => {
  const books = [
    book(1, 0.5, IDLE_PRELOAD_BOOK_MAX_BYTES), // 整本占满预算
    book(2, 0.5, 1024)
  ];
  const picked = pickIdlePreloadBooks(books, 10, IDLE_PRELOAD_BOOK_MAX_BYTES + 2048);
  assert.deepEqual(picked.map((b) => b.id), [2, 1]);

  const tight = pickIdlePreloadBooks(books, 10, 2048);
  assert.deepEqual(tight.map((b) => b.id), [2]);
});

test("scheduleIdlePreload 串行执行 chunk 与解析器任务，随后预热在读图书", async () => {
  const order: string[] = [];
  const primed: string[] = [];
  await scheduleIdlePreload({
    isActive: () => true,
    schedule: runNow,
    loadPanelChunks: () => [
      async () => { order.push("panel-a"); },
      async () => { order.push("panel-b"); }
    ],
    loadBookParsers: () => [async () => { order.push("parser"); }],
    fetchBooks: async () => {
      order.push("books");
      return [book(1, 0.5), book(2, null)];
    },
    primeResource: async (url) => {
      order.push("prime");
      primed.push(url);
    },
    token: () => "tok"
  });
  assert.deepEqual(order, ["panel-a", "panel-b", "parser", "books", "prime"]);
  assert.deepEqual(primed, ["/api/books/1/file?token=tok"]);
});

test("scheduleIdlePreload 登录态失效后停止后续步骤", async () => {
  const order: string[] = [];
  let active = true;
  await scheduleIdlePreload({
    isActive: () => active,
    schedule: runNow,
    loadPanelChunks: () => [
      async () => {
        order.push("panel-a");
        active = false; // 模拟登出
      },
      async () => { order.push("panel-b"); }
    ],
    loadBookParsers: () => [async () => { order.push("parser"); }],
    fetchBooks: async () => {
      order.push("books");
      return [];
    },
    primeResource: async () => { order.push("prime"); },
    token: () => "tok"
  });
  assert.deepEqual(order, ["panel-a"]);
});

test("scheduleIdlePreload 单个任务失败与书单失败都静默继续/结束", async () => {
  const order: string[] = [];
  await scheduleIdlePreload({
    isActive: () => true,
    schedule: runNow,
    loadPanelChunks: () => [
      async () => { throw new Error("chunk 加载失败"); },
      async () => { order.push("panel-b"); }
    ],
    loadBookParsers: () => [],
    fetchBooks: async () => { throw new Error("书单失败"); },
    primeResource: async () => { order.push("prime"); },
    token: () => "tok"
  });
  assert.deepEqual(order, ["panel-b"]); // 书单失败后静默结束，不预热文件
});

test("scheduleIdlePreload 省流/按量计费网络跳过图书文件预热但保留 chunk 预热", async () => {
  const order: string[] = [];
  await scheduleIdlePreload({
    isActive: () => true,
    schedule: runNow,
    loadPanelChunks: () => [async () => { order.push("panel"); }],
    loadBookParsers: () => [async () => { order.push("parser"); }],
    fetchBooks: async () => {
      order.push("books");
      return [book(1, 0.5)];
    },
    primeResource: async () => { order.push("prime"); },
    connection: () => ({ saveData: true }),
    token: () => "tok"
  });
  assert.deepEqual(order, ["panel", "parser"]);
});
