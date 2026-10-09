import assert from "node:assert/strict";
import test from "node:test";
import { bookPositionLabel, bookReadingUrl, bookShareContent, parseBookReadingUrl, wrapBookCardText } from "./bookReading";
const origin = "https://chat.example.test";
test("reading invitations preserve the sender's position and accept only local, finite locations", () => {
  const location = { bookId: 12, fraction: 0.731234 };
  assert.deepEqual(parseBookReadingUrl(bookReadingUrl(location, origin), origin), location);
  assert.deepEqual(parseBookReadingUrl('/?bookId=12&bookFraction=0', origin), { bookId: 12, fraction: 0 });
  for (const url of ["https://other.example.test/?bookId=12&bookFraction=0.1", "/?bookId=12&bookFraction=NaN", "/?bookId=0&bookFraction=0", "/?bookId=12&bookFraction=", "/?bookId=12&bookFraction=2", "/?bookId=9007199254740999&bookFraction=0", "/other?bookId=12&bookFraction=0"]) assert.equal(parseBookReadingUrl(url, origin), null);
});
test("excerpt shares escape EPUB text and embed a reading link", () => {
  const value = bookShareContent({ bookId: 2, fraction: .25, title: '<script>"book"</script>', chapter: "第一章", quote: '<img src=x onerror="bad()">\n原文' }, origin);
  assert.ok(!value.includes("<script>")); assert.ok(!value.includes("<img"));
  assert.match(value, /&lt;img/); assert.match(value, /bookId=2&amp;bookFraction=0.25/); assert.match(value, /打开书中的位置：第一章 · 25%/);
});
test("positions label numeric chapters and share the inviter's reading progress", () => {
  assert.equal(bookPositionLabel("2", .15), "第2章 · 15%");
  assert.equal(bookPositionLabel("", 0), "0%");
  assert.match(bookShareContent({ bookId: 2, fraction: .15, title: "图书", chapter: "2", quote: "" }, origin), /打开书中的位置：第2章 · 15%/);
});
test("excerpt cards wrap every character without losing Chinese or emoji", () => {
  const text = "第一行😊文字\n第二行";
  const lines = wrapBookCardText(text, (value) => Array.from(value).length, 4);
  assert.deepEqual(lines, ["第一行😊", "文字", "第二行"]);
});
