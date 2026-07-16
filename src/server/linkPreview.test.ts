import assert from "node:assert/strict";
import test from "node:test";
import { parseLinkPreview } from "./linkPreview.js";

test("link previews prefer a likely article hero over header logos and controls", () => {
  const preview = parseLinkPreview(
    `<!doctype html>
      <html>
        <head><title>一篇文章</title></head>
        <body>
          <header><img src="/_nuxt/img/m-header-logo2.png" alt="header logo" style="width:260px"></header>
          <img src="/_nuxt/img/speech-play.png" alt="">
          <main class="article-details"><img src="https://cdn.example.com/media/post/hero.png?w=921" alt=""></main>
          <footer><img src="/footer-logo.png" alt="footer logo"></footer>
        </body>
      </html>`,
    "https://example.com/news/44483/"
  );

  assert.equal(preview.image, "https://cdn.example.com/media/post/hero.png?w=921");
});

test("link previews recognize common lazy-loaded hero image attributes", () => {
  const preview = parseLinkPreview(
    `<html><head><title>Lazy</title></head><body><img src="/logo.png"><img data-src="/article/cover.jpg" class="article-hero" width="1200" height="675"></body></html>`,
    "https://example.com/story"
  );

  assert.equal(preview.image, "https://example.com/article/cover.jpg");
});
