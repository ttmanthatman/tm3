import assert from "node:assert/strict";
import test from "node:test";
import { SERMON_DISPLAY_FALLBACK, isLightSermonBackground, sermonDisplayAttrs, sermonDisplayStyle } from "./sermonDisplay.js";

test("sermonDisplayStyle：倍率与边距内联，预设背景不内联颜色", () => {
  assert.deepEqual(sermonDisplayStyle(SERMON_DISPLAY_FALLBACK), {
    "--sermon-font-scale": "1",
    "--sermon-margin-pct": "4"
  });
});

test("sermonDisplayStyle：自定义 hex 背景按亮度挑选前景色", () => {
  assert.deepEqual(sermonDisplayStyle({ ...SERMON_DISPLAY_FALLBACK, background: "#fafaf7" }), {
    "--sermon-font-scale": "1",
    "--sermon-margin-pct": "4",
    "--sermon-bg": "#fafaf7",
    "--sermon-fg": "#1f2937"
  });
  assert.deepEqual(sermonDisplayStyle({ ...SERMON_DISPLAY_FALLBACK, background: "#0f172a" }), {
    "--sermon-font-scale": "1",
    "--sermon-margin-pct": "4",
    "--sermon-bg": "#0f172a",
    "--sermon-fg": "#f5f1e6"
  });
});

test("sermonDisplayAttrs：预设背景进 data-sermon-bg，自定义 hex 置空", () => {
  assert.deepEqual(sermonDisplayAttrs(SERMON_DISPLAY_FALLBACK), { "data-sermon-font": "puhuiti", "data-sermon-bg": "gradient" });
  assert.deepEqual(sermonDisplayAttrs({ ...SERMON_DISPLAY_FALLBACK, fontFamily: "songti", background: "#123456" }), {
    "data-sermon-font": "songti",
    "data-sermon-bg": null
  });
});

test("isLightSermonBackground：相对亮度阈值", () => {
  assert.equal(isLightSermonBackground("#ffffff"), true);
  assert.equal(isLightSermonBackground("#f3ead7"), true);
  assert.equal(isLightSermonBackground("#000000"), false);
  assert.equal(isLightSermonBackground("#0f172a"), false);
});
