import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const css = fs.readFileSync(new URL("./styles.css", import.meta.url), "utf8");

test("narrow viewports always switch the chat shell to one column", () => {
  assert.doesNotMatch(css, /@media \(max-width: 760px\) and \((?:hover|pointer):/);
  assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*?\.app-shell \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
});

test("mobile drawers stay above the chat header and their scrim", () => {
  assert.match(css, /\.chat-head \{[\s\S]*?z-index: 21;/);
  assert.match(css, /\.scrim \{[\s\S]*?z-index: 22;/);
  assert.match(css, /\.member-pane \{[\s\S]*?z-index: 23;/);
  assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*?\.channel-pane \{[\s\S]*?z-index: 23;/);
});
