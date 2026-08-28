import assert from "node:assert/strict";
import test from "node:test";
import { SERMON_DISPLAY_FALLBACK, isLightSermonBackground, sermonDisplayAttrs, sermonDisplayStyle } from "./sermonDisplay.js";

test("sermonDisplayStyle：倍率与边距内联，预设背景不内联颜色", () => {
  assert.deepEqual(sermonDisplayStyle(SERMON_DISPLAY_FALLBACK), {
    "--sermon-font-scale": "1",
    "--sermon-margin-pct": "4",
    "--sermon-fg": "#f8f4e8"
  });
});

test("sermonDisplayStyle：显式文字颜色优先，旧状态按自定义背景亮度选择兼容色", () => {
  assert.deepEqual(sermonDisplayStyle({ ...SERMON_DISPLAY_FALLBACK, background: "#fafaf7", textColor: "#26334a" }), {
    "--sermon-font-scale": "1",
    "--sermon-margin-pct": "4",
    "--sermon-bg": "#fafaf7",
    "--sermon-fg": "#26334a"
  });
  const { textColor: _legacyTextColor, ...legacy } = SERMON_DISPLAY_FALLBACK;
  assert.deepEqual(sermonDisplayStyle({ ...legacy, background: "#0f172a" }), {
    "--sermon-font-scale": "1",
    "--sermon-margin-pct": "4",
    "--sermon-bg": "#0f172a",
    "--sermon-fg": "#f8f4e8"
  });
});

test("sermonDisplayAttrs：预设背景进 data-sermon-bg，自定义 hex 置空", () => {
  assert.deepEqual(sermonDisplayAttrs(SERMON_DISPLAY_FALLBACK), { "data-sermon-font": "songti", "data-sermon-bg": "gradient" });
  assert.deepEqual(sermonDisplayAttrs({ ...SERMON_DISPLAY_FALLBACK, fontFamily: "kaiti", background: "#123456" }), {
    "data-sermon-font": "kaiti",
    "data-sermon-bg": null
  });
});

test("isLightSermonBackground：相对亮度阈值", () => {
  assert.equal(isLightSermonBackground("#ffffff"), true);
  assert.equal(isLightSermonBackground("#f3ead7"), true);
  assert.equal(isLightSermonBackground("#000000"), false);
  assert.equal(isLightSermonBackground("#0f172a"), false);
});
